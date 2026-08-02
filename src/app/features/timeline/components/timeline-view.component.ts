import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  computed,
  effect,
  inject,
  signal,
  viewChild
} from '@angular/core';

import { ReolinkEventService } from '../../../data-access/reolink/reolink-event.service';
import { CameraWorkspaceStore } from '../../camera-workspace/state/camera-workspace.store';
import { PlaybackStore } from '../../playback/state/playback.store';
import { TimelineStore } from '../state/timeline.store';

type TimelineViewMode = 'preview' | 'video';
type BootPhase = 'idle' | 'waiting-preview' | 'ready';

@Component({
  selector: 'app-timeline-view',
  standalone: true,
  templateUrl: './timeline-view.component.html',
  styleUrl: './timeline-view.component.scss'
})
export class TimelineViewComponent implements AfterViewInit, OnDestroy {
  private readonly idleToPlayMs = 2000;
  private readonly liveTimestampToleranceMs = 60_000;
  private readonly timelineScrollerRef = viewChild<ElementRef<HTMLDivElement>>('timelineScroller');

  protected readonly timelineStore = inject(TimelineStore);
  protected readonly playbackStore = inject(PlaybackStore);
  protected readonly cameraWorkspaceStore = inject(CameraWorkspaceStore);
  protected readonly reolinkEventService = inject(ReolinkEventService);

  protected readonly mode = signal<TimelineViewMode>('preview');
  protected readonly selectedTimestampMs = signal<number | null>(null);
  protected readonly isSeeking = signal(false);

  private readonly bootPhase = signal<BootPhase>('idle');
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private suppressScrollEvent = false;

  protected readonly loadedWindow = computed(() => this.timelineStore.timelineState().loadedWindow);
  protected readonly previewFrame = computed(() => this.timelineStore.timelineState().previewFrame);
  protected readonly previewStatus = computed(() => this.timelineStore.timelineState().previewStatus);
  protected readonly playbackState = computed(() => this.playbackStore.playbackState());
  protected readonly selectedCamera = computed(() => this.cameraWorkspaceStore.selectedCamera());
  protected readonly timelineMarkers = computed(() => this.loadedWindow()?.timelineMarkerEvents ?? []);

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

  protected readonly mqttStatus = computed(() => {
    const connected = this.reolinkEventService.isConnected();
    const markerCount = this.timelineMarkers().filter((marker) => marker.source === 'reolink-mqtt').length;
    const lastActivityAt = this.reolinkEventService.getLastActivityAt();
    const recentActivity = Date.now() - lastActivityAt < 15_000;

    if (!connected) {
      return { label: 'MQTT offline', tone: 'offline' as const };
    }

    if (markerCount > 0 && recentActivity) {
      return { label: `MQTT live • ${markerCount}`, tone: 'live' as const };
    }

    if (recentActivity) {
      return { label: 'MQTT active', tone: 'connected' as const };
    }

    return { label: 'MQTT connected', tone: 'connected' as const };
  });

  protected readonly markerPositions = computed(() => {
    const loadedWindow = this.loadedWindow();

    if (!loadedWindow) {
      return [] as Array<{ id: string; left: string; width: string; label: string; kind: string }>;
    }

    const rangeMs = Math.max(loadedWindow.requestEndMs - loadedWindow.requestStartMs, 1);

    return this.timelineMarkers().map((marker) => {
      const leftRatio = Math.min(
        Math.max((marker.startMs - loadedWindow.requestStartMs) / rangeMs, 0),
        1
      );
      const widthRatio = Math.min(
        Math.max((marker.endMs - marker.startMs) / Math.max(rangeMs / 24, 1), 0.04),
        0.2
      );

      return {
        id: marker.id,
        left: `${leftRatio * 100}%`,
        width: `${widthRatio * 100}%`,
        label: marker.label || marker.type,
        kind: marker.source === 'reolink-mqtt' ? 'mqtt' : 'review'
      };
    });
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
        const initialTimestampMs = Math.min(Date.now(), loadedWindow.requestEndMs);
        const clampedInitialTimestampMs = Math.max(initialTimestampMs, loadedWindow.requestStartMs);
        this.selectedTimestampMs.set(clampedInitialTimestampMs);
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
  }

  ngAfterViewInit(): void {
    this.syncScrollToTimestamp();
  }

  ngOnDestroy(): void {
    this.clearIdleTimer();
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

    const maxScrollTop = Math.max(target.scrollHeight - target.clientHeight, 1);
    const ratio = Math.min(Math.max(target.scrollTop / maxScrollTop, 0), 1);
    const timestampMs = Math.round(
      loadedWindow.requestStartMs + ratio * (loadedWindow.requestEndMs - loadedWindow.requestStartMs)
    );

    this.setSelectionFromInteraction(timestampMs);
  }

  protected handleTimelinePointerDown(): void {
    this.isSeeking.set(true);
    this.mode.set('preview');
    this.clearIdleTimer();
  }

  protected handleTimelinePointerUp(): void {
    this.isSeeking.set(false);
    this.scheduleIdleToPlay();
  }

  protected handleVideoLoadStart(): void {
    this.playbackStore.setPlayerStatus('loading');
  }

  protected handleVideoCanPlay(): void {
    this.playbackStore.setPlayerStatus('ready');
  }

  protected handleVideoPlay(): void {
    this.playbackStore.setPlayerStatus('playing');
  }

  protected handleVideoPause(): void {
    if (this.playbackState().resolvedSource) {
      this.playbackStore.setPlayerStatus('ready');
    }
  }

  protected handleVideoError(): void {
    this.playbackStore.setPlayerStatus('error');
    this.mode.set('preview');
  }

  private setSelectionFromInteraction(timestampMs: number): void {
    const loadedWindow = this.loadedWindow();

    if (!loadedWindow) {
      return;
    }

    const maxInteractiveTimestampMs = this.resolveMaxInteractiveTimestampMs(loadedWindow.requestEndMs);
    const clampedTimestampMs = Math.min(
      Math.max(timestampMs, loadedWindow.requestStartMs),
      maxInteractiveTimestampMs
    );

    this.selectedTimestampMs.set(clampedTimestampMs);
    this.mode.set('preview');
    this.pushTimelineSelection();
    this.scheduleIdleToPlay();
  }

  private resolveMaxInteractiveTimestampMs(requestEndMs: number): number {
    return Math.min(requestEndMs, Date.now());
  }

  private scheduleIdleToPlay(): void {
    this.clearIdleTimer();
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      this.isSeeking.set(false);
      this.playVideoFromSelection();
    }, this.idleToPlayMs);
  }

  private clearIdleTimer(): void {
    if (this.idleTimer !== null) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  private playVideoFromSelection(): void {
    const timestampMs = this.selectedTimestampMs();

    if (timestampMs === null) {
      return;
    }

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

    const totalRangeMs = Math.max(loadedWindow.requestEndMs - loadedWindow.requestStartMs, 1);
    const ratio =
      (selectedTimestampMs - loadedWindow.requestStartMs) /
      totalRangeMs;
    const maxScrollTop = Math.max(scroller.scrollHeight - scroller.clientHeight, 0);
    const nextScrollTop = Math.min(Math.max(ratio * maxScrollTop, 0), maxScrollTop);

    if (Math.abs(scroller.scrollTop - nextScrollTop) < 1) {
      return;
    }

    this.suppressScrollEvent = true;
    scroller.scrollTop = nextScrollTop;
    queueMicrotask(() => {
      this.suppressScrollEvent = false;
    });
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
