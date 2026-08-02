import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  computed,
  effect,
  inject,
  isDevMode,
  signal,
  viewChild
} from '@angular/core';
import type { TimelineWindow } from '../../../data-access/frigate/adapter/frigate-adapter';

import { CameraWorkspaceStore } from '../../camera-workspace/state/camera-workspace.store';
import { PlaybackStore } from '../../playback/state/playback.store';
import { TimelinePreviewCache } from '../state/timeline-preview-cache';
import { TimelineStore } from '../state/timeline.store';

type TimelineViewMode = 'preview' | 'video';
type BootPhase = 'idle' | 'waiting-preview' | 'ready';
type ScrubPhase = 'STATIONARY' | 'ACTIVE_SCRUB' | 'VELOCITY_LOOP' | 'SETTLED_SEEK';

@Component({
  selector: 'app-timeline-view',
  standalone: true,
  templateUrl: './timeline-view.component.html',
  styleUrl: './timeline-view.component.scss'
})
export class TimelineViewComponent implements AfterViewInit, OnDestroy {
  private readonly idleToPlayMs = 2000;
  private readonly previewToVideoRequestDelayMs = 1500;
  private readonly liveTimestampToleranceMs = 60_000;
  private readonly settleThresholdMs = 150;
  private readonly lowVelocityThresholdPxPerSec = 100;
  private readonly prefetchWindowSeconds = 180;
  private readonly prefetchStepMs = 2_000;
  private readonly fastSampleMinMs = 60_000;
  private readonly fastSampleMaxMs = 120_000;
  private readonly timelineScrollerRef = viewChild<ElementRef<HTMLDivElement>>('timelineScroller');

  protected readonly timelineStore = inject(TimelineStore);
  protected readonly playbackStore = inject(PlaybackStore);
  protected readonly cameraWorkspaceStore = inject(CameraWorkspaceStore);

  protected readonly mode = signal<TimelineViewMode>('preview');
  protected readonly selectedTimestampMs = signal<number | null>(null);
  protected readonly isSeeking = signal(false);
  protected readonly videoSurfaceReady = signal(false);
  protected readonly scrubPhase = signal<ScrubPhase>('STATIONARY');
  protected readonly userInteracting = signal(false);
  protected readonly currentVelocityPxPerSec = signal(0);
  protected readonly cachedPreviewUrl = signal<string | null>(null);
  protected readonly showDebugBadges = signal(isDevMode());
  protected readonly prefetchRequestedCount = signal(0);
  protected readonly prefetchLoadedCount = signal(0);
  protected readonly prefetchCacheHitCount = signal(0);
  protected readonly prefetchAbortCount = signal(0);
  protected readonly prefetchErrorCount = signal(0);

  private readonly bootPhase = signal<BootPhase>('idle');
  private readonly previewCache = new TimelinePreviewCache();
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private settleTimer: ReturnType<typeof setTimeout> | null = null;
  private suppressScrollEvent = false;
  private lastScrollTop: number | null = null;
  private lastScrollAtMs: number | null = null;
  private scrollDirection: -1 | 0 | 1 = 0;
  private pendingPrefetchAbort: AbortController | null = null;
  private lastPrefetchCenterMs: number | null = null;
  private lastDenseSampleCenterMs: number | null = null;
  private lastSparseSampleCenterMs: number | null = null;

  protected readonly loadedWindow = computed(() => this.timelineStore.timelineState().loadedWindow);
  protected readonly previewFrame = computed(() => this.timelineStore.timelineState().previewFrame);
  protected readonly previewStatus = computed(() => this.timelineStore.timelineState().previewStatus);
  protected readonly playbackState = computed(() => this.playbackStore.playbackState());
  protected readonly isVideoRequestPending = computed(() => {
    const playerStatus = this.playbackState().playerStatus;
    const waitingForVideoSurface =
      this.mode() === 'video' && this.hasVideoSource() && !this.videoSurfaceReady();

    return playerStatus === 'resolving' || playerStatus === 'loading' || waitingForVideoSurface;
  });
  protected readonly showPreviewSurface = computed(
    () => this.mode() === 'preview' || !this.hasVideoSource() || this.isVideoRequestPending()
  );
  protected readonly showVideoSurface = computed(
    () => this.mode() === 'video' && this.hasVideoSource()
  );
  protected readonly selectedCamera = computed(() => this.cameraWorkspaceStore.selectedCamera());
  protected readonly maxSelectableTimestampMs = computed(() => {
    const loadedWindow = this.loadedWindow();

    if (!loadedWindow) {
      return 0;
    }

    return this.resolveMaxInteractiveTimestampWithinWindow(loadedWindow);
  });
  protected readonly futureDisabledPercent = computed(() => {
    const loadedWindow = this.loadedWindow();

    if (!loadedWindow) {
      return 0;
    }

    const maxInteractiveTimestampMs = this.resolveMaxInteractiveTimestampWithinWindow(loadedWindow);
    const totalRangeMs = Math.max(loadedWindow.requestEndMs - loadedWindow.requestStartMs, 1);
    const disabledRangeMs = Math.max(loadedWindow.requestEndMs - maxInteractiveTimestampMs, 0);

    return Math.min((disabledRangeMs / totalRangeMs) * 100, 100);
  });
  protected readonly activePreviewImageUrl = computed(() => {
    const cachedUrl = this.cachedPreviewUrl();

    if (cachedUrl) {
      return cachedUrl;
    }

    return this.previewFrame()?.imageUrl ?? null;
  });

  protected readonly selectedTimestampLabel = computed(() => {
    const timestampMs = this.selectedTimestampMs();

    if (timestampMs === null) {
      return '--:--';
    }

    return this.formatClock(timestampMs);
  });

  protected readonly selectedTimestampSubtitle = computed(() => {
    const timestampMs = this.selectedTimestampMs();

    if (timestampMs === null) {
      return 'No timestamp selected';
    }

    return this.formatDateTime(timestampMs);
  });

  protected readonly hasVideoSource = computed(
    () => this.playbackState().resolvedSource !== null
  );

  protected readonly showLivePill = computed(() => {
    const loadedWindow = this.loadedWindow();
    const selectedTimestampMs = this.selectedTimestampMs();

    if (!loadedWindow || selectedTimestampMs === null) {
      return false;
    }

    return selectedTimestampMs >= loadedWindow.requestEndMs - this.liveTimestampToleranceMs;
  });

  protected readonly playbackDebugBadge = computed(() => {
    const playerStatus = this.playbackState().playerStatus;
    const mode = this.mode();
    const pending = this.isVideoRequestPending() ? 'yes' : 'no';
    const source = this.hasVideoSource() ? 'yes' : 'no';
    const surface = this.videoSurfaceReady() ? 'yes' : 'no';

    return `mode:${mode} status:${playerStatus} pending:${pending} src:${source} surface:${surface}`;
  });

  protected readonly prefetchDebugBadge = computed(() => {
    const requested = this.prefetchRequestedCount();
    const loaded = this.prefetchLoadedCount();
    const cached = this.prefetchCacheHitCount();
    const aborted = this.prefetchAbortCount();
    const errors = this.prefetchErrorCount();
    const cacheSize = this.previewCache.size();

    return `prefetch req:${requested} ok:${loaded} cache:${cached} abort:${aborted} err:${errors} size:${cacheSize}`;
  });

  protected readonly timelineMarks = computed(() => {
    const loadedWindow = this.loadedWindow();

    if (!loadedWindow) {
      return [] as Array<{ timestampMs: number; label: string }>;
    }

    const startMs = loadedWindow.requestStartMs;
    const endMs = loadedWindow.requestEndMs;
    const totalRangeMs = Math.max(endMs - startMs, 1);
    const targetMarkCount = 36;
    const rawStepMs = totalRangeMs / targetMarkCount;
    const roundedStepMs = this.roundStepToUsefulInterval(rawStepMs);
    const marks: Array<{ timestampMs: number; label: string }> = [];

    let timestampMs = Math.ceil(startMs / roundedStepMs) * roundedStepMs;

    while (timestampMs <= endMs) {
      marks.push({
        timestampMs,
        label: this.formatClock(timestampMs)
      });
      timestampMs += roundedStepMs;
    }

    if (marks.length === 0 || marks[0].timestampMs !== startMs) {
      marks.unshift({ timestampMs: startMs, label: this.formatClock(startMs) });
    }

    if (marks[marks.length - 1].timestampMs !== endMs) {
      marks.push({ timestampMs: endMs, label: this.formatClock(endMs) });
    }

    return marks;
  });

  constructor() {
    effect(() => {
      const loadedWindow = this.loadedWindow();

      if (!loadedWindow) {
        return;
      }

      if (this.selectedTimestampMs() === null) {
        const initialTimestampMs = this.clampInteractiveTimestamp(loadedWindow.requestEndMs, loadedWindow);
        this.selectedTimestampMs.set(initialTimestampMs);
      }

      if (this.bootPhase() === 'idle') {
        this.mode.set('preview');
        this.bootPhase.set('waiting-preview');
        this.pushTimelineSelection();
      }
    });

    effect(() => {
      if (this.bootPhase() !== 'waiting-preview') {
        return;
      }

      const previewStatus = this.previewStatus();

      if (previewStatus === 'loading') {
        return;
      }

      this.bootPhase.set('ready');
      this.playVideoFromSelection();
    });

    effect(() => {
      this.loadedWindow();
      this.selectedTimestampMs();
      queueMicrotask(() => this.syncScrollToTimestamp());
    });

    effect(() => {
      const previewFrame = this.previewFrame();

      if (!previewFrame?.imageUrl) {
        return;
      }

      this.previewCache.set(previewFrame.timestampMs, previewFrame.imageUrl);
      this.showCachedPreviewForTimestamp(previewFrame.timestampMs);
    });

    effect(() => {
      const phase = this.scrubPhase();
      const selectedTimestampMs = this.selectedTimestampMs();
      const selectedCameraId = this.selectedCamera()?.id;
      const loadedWindow = this.loadedWindow();

      if (
        (phase !== 'STATIONARY' && phase !== 'SETTLED_SEEK') ||
        selectedTimestampMs === null ||
        !selectedCameraId ||
        !loadedWindow
      ) {
        return;
      }

      void this.prefetchStationaryWindow(selectedCameraId, selectedTimestampMs, loadedWindow);
    });
  }

  ngAfterViewInit(): void {
    this.syncScrollToTimestamp();
  }

  ngOnDestroy(): void {
    this.clearIdleTimer();
    this.clearSettleTimer();
    this.cancelPendingNetworkWork();
  }

  protected handleTimelineScroll(event: Event): void {
    if (this.suppressScrollEvent) {
      return;
    }

    const loadedWindow = this.loadedWindow();

    if (!loadedWindow) {
      return;
    }

    const target = event.target as HTMLDivElement | null;

    if (!target) {
      return;
    }

    const clampedScrollTop = this.clampInteractiveScrollTop(target.scrollTop, target, loadedWindow);

    if (Math.abs(target.scrollTop - clampedScrollTop) >= 1) {
      this.suppressScrollEvent = true;
      target.scrollTop = clampedScrollTop;
      queueMicrotask(() => {
        this.suppressScrollEvent = false;
      });
    }

    const nowMs = Date.now();
    const velocity = this.updateScrubVelocity(clampedScrollTop, nowMs);
    this.currentVelocityPxPerSec.set(velocity);
    this.scrubPhase.set('VELOCITY_LOOP');

    const timestampMs = this.resolveTimestampFromScrollTop(clampedScrollTop, target, loadedWindow);

    this.setSelectionFromInteraction(timestampMs);
    this.runVelocitySampling(timestampMs, velocity, loadedWindow);
    this.scheduleSettledSeek();
  }

  protected handleTimelinePointerDown(): void {
    this.beginScrubInteraction();
  }

  protected handleTimelinePointerUp(): void {
    this.endScrubInteraction();
    this.scheduleSettledSeek();
  }

  protected handleVideoLoadStart(): void {
    this.playbackStore.setPlayerStatus('loading');
  }

  protected handleVideoCanPlay(): void {
    this.videoSurfaceReady.set(true);
    this.playbackStore.setPlayerStatus('ready');
  }

  protected handleVideoPlay(): void {
    this.videoSurfaceReady.set(true);
    this.playbackStore.setPlayerStatus('playing');
  }

  protected handleVideoPause(): void {
    if (this.playbackState().resolvedSource) {
      this.playbackStore.setPlayerStatus('ready');
    }
  }

  protected handleVideoError(): void {
    this.videoSurfaceReady.set(false);
    this.playbackStore.setPlayerStatus('error');
    this.mode.set('preview');
  }

  private setSelectionFromInteraction(timestampMs: number): void {
    const loadedWindow = this.loadedWindow();

    if (!loadedWindow) {
      return;
    }

    const clampedTimestampMs = this.clampInteractiveTimestamp(timestampMs, loadedWindow);
    this.selectedTimestampMs.set(clampedTimestampMs);
    this.showCachedPreviewForTimestamp(clampedTimestampMs);
    this.mode.set('preview');
    this.pushTimelineSelection();
  }

  private scheduleIdleToPlay(): void {
    const hasRenderedPreview = this.activePreviewImageUrl() !== null;
    const waitMs = this.idleToPlayMs + (hasRenderedPreview ? this.previewToVideoRequestDelayMs : 0);

    this.clearIdleTimer();
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      this.isSeeking.set(false);
      this.scrubPhase.set('STATIONARY');
      this.showCachedPreviewForTimestamp(this.selectedTimestampMs());
      this.playVideoFromSelection();
    }, waitMs);
  }

  private clearIdleTimer(): void {
    if (this.idleTimer !== null) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  private clearSettleTimer(): void {
    if (this.settleTimer !== null) {
      clearTimeout(this.settleTimer);
      this.settleTimer = null;
    }
  }

  private cancelPendingNetworkWork(): void {
    this.pendingPrefetchAbort?.abort();
    this.pendingPrefetchAbort = null;
    this.previewCache.clear();
    this.cachedPreviewUrl.set(null);
  }

  private beginScrubInteraction(): void {
    this.pendingPrefetchAbort?.abort();
    this.pendingPrefetchAbort = null;
    this.lastPrefetchCenterMs = null;
    this.userInteracting.set(true);
    this.isSeeking.set(true);
    this.mode.set('preview');
    this.scrubPhase.set('ACTIVE_SCRUB');
    this.currentVelocityPxPerSec.set(0);
    this.clearIdleTimer();
    this.clearSettleTimer();
  }

  private endScrubInteraction(): void {
    this.userInteracting.set(false);
    this.isSeeking.set(false);
  }

  private updateScrubVelocity(nextScrollTop: number, nowMs: number): number {
    const previousScrollTop = this.lastScrollTop;
    const previousScrollAtMs = this.lastScrollAtMs;
    this.lastScrollTop = nextScrollTop;
    this.lastScrollAtMs = nowMs;

    if (previousScrollTop === null || previousScrollAtMs === null) {
      this.scrollDirection = 0;
      return 0;
    }

    const delta = nextScrollTop - previousScrollTop;
    const deltaPx = Math.abs(delta);
    this.scrollDirection = delta === 0 ? 0 : delta > 0 ? 1 : -1;
    const deltaMs = Math.max(nowMs - previousScrollAtMs, 1);
    return (deltaPx / deltaMs) * 1000;
  }

  private runVelocitySampling(
    centerTimestampMs: number,
    velocityPxPerSec: number,
    loadedWindow: TimelineWindow
  ): void {
    const cameraId = this.selectedCamera()?.id;

    if (!cameraId) {
      return;
    }

    if (velocityPxPerSec < this.lowVelocityThresholdPxPerSec) {
      void this.prefetchDenseAround(cameraId, centerTimestampMs, loadedWindow);
      return;
    }

    void this.prefetchSparseAlongVelocity(cameraId, centerTimestampMs, loadedWindow, velocityPxPerSec);
  }

  private async prefetchDenseAround(
    cameraId: string,
    centerTimestampMs: number,
    loadedWindow: TimelineWindow
  ): Promise<void> {
    const previousCenter = this.lastDenseSampleCenterMs;

    if (previousCenter !== null && Math.abs(previousCenter - centerTimestampMs) < this.prefetchStepMs) {
      return;
    }

    this.lastDenseSampleCenterMs = centerTimestampMs;
    const abortController = this.startNewPrefetchCycle();

    const denseStepMs = this.prefetchStepMs;
    const denseTargets = [
      centerTimestampMs - 2 * denseStepMs,
      centerTimestampMs - denseStepMs,
      centerTimestampMs,
      centerTimestampMs + denseStepMs,
      centerTimestampMs + 2 * denseStepMs
    ]
      .map((timestampMs) => this.clampInteractiveTimestamp(timestampMs, loadedWindow))
      .filter((timestampMs, index, list) => list.indexOf(timestampMs) === index);

    await this.fetchPreviewTargets(cameraId, denseTargets, abortController);
  }

  private async prefetchSparseAlongVelocity(
    cameraId: string,
    centerTimestampMs: number,
    loadedWindow: TimelineWindow,
    velocityPxPerSec: number
  ): Promise<void> {
    const previousCenter = this.lastSparseSampleCenterMs;

    if (previousCenter !== null && Math.abs(previousCenter - centerTimestampMs) < this.fastSampleMinMs / 2) {
      return;
    }

    this.lastSparseSampleCenterMs = centerTimestampMs;
    const abortController = this.startNewPrefetchCycle();

    const velocityRatio = Math.min(
      velocityPxPerSec / (this.lowVelocityThresholdPxPerSec * 8),
      1
    );
    const sparseStepMs = Math.round(
      this.fastSampleMinMs + (this.fastSampleMaxMs - this.fastSampleMinMs) * velocityRatio
    );
    const direction = this.scrollDirection === 0 ? 1 : this.scrollDirection;

    const sparseTargets = [
      centerTimestampMs,
      centerTimestampMs + direction * sparseStepMs,
      centerTimestampMs + direction * 2 * sparseStepMs,
      centerTimestampMs + direction * 3 * sparseStepMs,
      centerTimestampMs - direction * sparseStepMs
    ]
      .map((timestampMs) => this.clampInteractiveTimestamp(timestampMs, loadedWindow))
      .filter((timestampMs, index, list) => list.indexOf(timestampMs) === index);

    await this.fetchPreviewTargets(cameraId, sparseTargets, abortController);
  }

  private startNewPrefetchCycle(): AbortController {
    if (this.pendingPrefetchAbort) {
      this.pendingPrefetchAbort.abort();
      this.prefetchAbortCount.update((count) => count + 1);
    }
    const abortController = new AbortController();
    this.pendingPrefetchAbort = abortController;
    return abortController;
  }

  private async fetchPreviewTargets(
    cameraId: string,
    targets: number[],
    abortController: AbortController
  ): Promise<void> {
    for (const timestampMs of targets) {
      if (abortController.signal.aborted) {
        return;
      }

      if (this.previewCache.has(timestampMs)) {
        this.prefetchCacheHitCount.update((count) => count + 1);
        continue;
      }

      this.prefetchRequestedCount.update((count) => count + 1);

      const previewFrame = await this.timelineStore.getPreviewFrameAt(cameraId, timestampMs);

      if (!previewFrame?.imageUrl || abortController.signal.aborted) {
        if (!abortController.signal.aborted) {
          this.prefetchErrorCount.update((count) => count + 1);
        }
        continue;
      }

      const preloaded = await this.preloadPreviewImage(previewFrame.imageUrl, abortController.signal);

      if (!preloaded || abortController.signal.aborted) {
        if (!abortController.signal.aborted) {
          this.prefetchErrorCount.update((count) => count + 1);
        }
        continue;
      }

      this.previewCache.set(timestampMs, previewFrame.imageUrl);
      this.prefetchLoadedCount.update((count) => count + 1);
    }
  }

  private async preloadPreviewImage(imageUrl: string, signal: AbortSignal): Promise<boolean> {
    if (signal.aborted) {
      return false;
    }

    return await new Promise<boolean>((resolve) => {
      const image = new Image();

      const cleanup = (): void => {
        image.onload = null;
        image.onerror = null;
        signal.removeEventListener('abort', handleAbort);
      };

      const finish = (loaded: boolean): void => {
        cleanup();
        resolve(loaded);
      };

      const handleAbort = (): void => {
        image.src = '';
        finish(false);
      };

      signal.addEventListener('abort', handleAbort, { once: true });

      image.onload = () => finish(true);
      image.onerror = () => finish(false);
      image.src = imageUrl;
    });
  }

  private scheduleSettledSeek(): void {
    this.clearSettleTimer();
    this.settleTimer = setTimeout(() => {
      this.settleTimer = null;
      this.runSettledSeek();
    }, this.settleThresholdMs);
  }

  private runSettledSeek(): void {
    const loadedWindow = this.loadedWindow();
    const currentTimestampMs = this.selectedTimestampMs();

    if (!loadedWindow || currentTimestampMs === null) {
      return;
    }

    this.scrubPhase.set('SETTLED_SEEK');
    const snappedTimestampMs = this.applyMagneticSnap(currentTimestampMs);
    const clampedTimestampMs = this.clampInteractiveTimestamp(snappedTimestampMs, loadedWindow);
    this.selectedTimestampMs.set(clampedTimestampMs);
    this.showCachedPreviewForTimestamp(clampedTimestampMs);
    this.pushTimelineSelection();

    if (!this.userInteracting()) {
      this.scheduleIdleToPlay();
    }
  }

  private async prefetchStationaryWindow(
    cameraId: string,
    centerTimestampMs: number,
    loadedWindow: TimelineWindow
  ): Promise<void> {
    this.lastPrefetchCenterMs = centerTimestampMs;
    const abortController = this.startNewPrefetchCycle();

    const prefetchRadiusMs = this.prefetchWindowSeconds * 1000;
    const rangeStartMs = this.clampInteractiveTimestamp(centerTimestampMs - prefetchRadiusMs, loadedWindow);
    const rangeEndMs = this.clampInteractiveTimestamp(centerTimestampMs + prefetchRadiusMs, loadedWindow);

    this.previewCache.pruneOutsideRange(rangeStartMs, rangeEndMs);

    const targets: number[] = [];
    for (let timestampMs = rangeStartMs; timestampMs <= rangeEndMs; timestampMs += this.prefetchStepMs) {
      targets.push(timestampMs);
    }

    await this.fetchPreviewTargets(cameraId, targets, abortController);
  }

  private showCachedPreviewForTimestamp(timestampMs: number | null): void {
    if (timestampMs === null) {
      this.cachedPreviewUrl.set(null);
      return;
    }

    const exactCacheHit = this.previewCache.get(timestampMs);

    if (exactCacheHit) {
      this.cachedPreviewUrl.set(exactCacheHit);
      return;
    }

    const nearestCacheHit = this.previewCache.nearest(timestampMs, this.prefetchStepMs * 2);

    // Keep the last rendered preview visible if no nearby cached frame is available yet.
    if (nearestCacheHit) {
      this.cachedPreviewUrl.set(nearestCacheHit);
    }
  }

  private playVideoFromSelection(): void {
    const timestampMs = this.selectedTimestampMs();

    if (timestampMs === null) {
      return;
    }

    this.videoSurfaceReady.set(false);
    this.mode.set('video');
    this.playbackStore.setTargetTimestamp(timestampMs);
  }

  private pushTimelineSelection(): void {
    const timestampMs = this.selectedTimestampMs();
    this.timelineStore.setScrubTimestamp(timestampMs);
    this.timelineStore.setHoveredTimestamp(timestampMs);
  }

  private syncScrollToTimestamp(): void {
    const scroller = this.timelineScrollerRef()?.nativeElement;
    const loadedWindow = this.loadedWindow();
    const selectedTimestampMs = this.selectedTimestampMs();

    if (!scroller || !loadedWindow || selectedTimestampMs === null) {
      return;
    }

    const nextScrollTop = this.resolveScrollTopFromTimestamp(selectedTimestampMs, scroller, loadedWindow);

    if (Math.abs(scroller.scrollTop - nextScrollTop) < 1) {
      return;
    }

    this.suppressScrollEvent = true;
    scroller.scrollTop = nextScrollTop;
    queueMicrotask(() => {
      this.suppressScrollEvent = false;
    });
  }

  private resolveCenterlineOffsetPx(scroller: HTMLDivElement): number {
    return scroller.clientHeight / 2;
  }

  private resolveTimestampFromScrollTop(
    scrollTop: number,
    scroller: HTMLDivElement,
    loadedWindow: TimelineWindow
  ): number {
    const centerlineOffsetPx = this.resolveCenterlineOffsetPx(scroller);
    const centerPx = scrollTop + centerlineOffsetPx;
    const minCenterPx = centerlineOffsetPx;
    const maxCenterPx = Math.max(scroller.scrollHeight - centerlineOffsetPx, minCenterPx + 1);
    const ratio = Math.min(Math.max((centerPx - minCenterPx) / (maxCenterPx - minCenterPx), 0), 1);

    return Math.round(
      loadedWindow.requestStartMs + ratio * (loadedWindow.requestEndMs - loadedWindow.requestStartMs)
    );
  }

  private resolveScrollTopFromTimestamp(
    timestampMs: number,
    scroller: HTMLDivElement,
    loadedWindow: TimelineWindow
  ): number {
    const totalRangeMs = Math.max(loadedWindow.requestEndMs - loadedWindow.requestStartMs, 1);
    const ratio = (timestampMs - loadedWindow.requestStartMs) / totalRangeMs;
    const centerlineOffsetPx = this.resolveCenterlineOffsetPx(scroller);
    const minCenterPx = centerlineOffsetPx;
    const maxCenterPx = Math.max(scroller.scrollHeight - centerlineOffsetPx, minCenterPx + 1);
    const centerPx = minCenterPx + Math.min(Math.max(ratio, 0), 1) * (maxCenterPx - minCenterPx);
    const maxScrollTop = Math.max(scroller.scrollHeight - scroller.clientHeight, 0);

    return Math.min(Math.max(centerPx - centerlineOffsetPx, 0), maxScrollTop);
  }

  private clampInteractiveScrollTop(
    scrollTop: number,
    scroller: HTMLDivElement,
    loadedWindow: TimelineWindow
  ): number {
    const maxInteractiveTimestampMs = this.resolveMaxInteractiveTimestampWithinWindow(loadedWindow);
    const maxInteractiveScrollTop = this.resolveScrollTopFromTimestamp(
      maxInteractiveTimestampMs,
      scroller,
      loadedWindow
    );

    return Math.min(scrollTop, maxInteractiveScrollTop);
  }

  private clampInteractiveTimestamp(timestampMs: number, loadedWindow: TimelineWindow): number {
    const maxInteractiveTimestampMs = this.resolveMaxInteractiveTimestampMs(loadedWindow.requestEndMs);
    return Math.min(Math.max(timestampMs, loadedWindow.requestStartMs), maxInteractiveTimestampMs);
  }

  private resolveMaxInteractiveTimestampMs(requestEndMs: number): number {
    return Math.min(requestEndMs, Date.now());
  }

  private resolveMaxInteractiveTimestampWithinWindow(loadedWindow: TimelineWindow): number {
    const maxInteractiveTimestampMs = this.resolveMaxInteractiveTimestampMs(loadedWindow.requestEndMs);
    return Math.min(
      Math.max(maxInteractiveTimestampMs, loadedWindow.requestStartMs),
      loadedWindow.requestEndMs
    );
  }

  private resolveNearestMarkerTimestamp(targetMs: number): number | null {
    const loadedWindow = this.loadedWindow();

    if (!loadedWindow || loadedWindow.reviewEvents.length === 0) {
      return null;
    }

    const nearestMarker = loadedWindow.reviewEvents.reduce((nearest, marker) => {
      if (nearest === null) {
        return marker;
      }

      const nearestDistance = Math.abs(nearest.startMs - targetMs);
      const markerDistance = Math.abs(marker.startMs - targetMs);
      return markerDistance < nearestDistance ? marker : nearest;
    }, null as TimelineWindow['reviewEvents'][number] | null);

    return nearestMarker?.startMs ?? null;
  }

  private applyMagneticSnap(targetMs: number): number {
    return this.resolveNearestMarkerTimestamp(targetMs) ?? targetMs;
  }

  private formatClock(timestampMs: number): string {
    const date = new Date(timestampMs);
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
  }

  private formatDateTime(timestampMs: number): string {
    const date = new Date(timestampMs);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}`;
  }

  private roundStepToUsefulInterval(stepMs: number): number {
    const minute = 60 * 1000;
    const candidates = [
      5 * minute,
      10 * minute,
      15 * minute,
      30 * minute,
      60 * minute,
      2 * 60 * minute,
      3 * 60 * minute,
      4 * 60 * minute,
      6 * 60 * minute
    ];

    for (const candidate of candidates) {
      if (candidate >= stepMs) {
        return candidate;
      }
    }

    return 12 * 60 * minute;
  }
}
