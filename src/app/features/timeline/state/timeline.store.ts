import { Injectable, computed, effect, inject, signal } from '@angular/core';

import { FRIGATE_ADAPTER } from '../../../data-access/frigate/adapter/frigate-adapter.token';
import type {
  PreviewFrame,
  RecordingSegment,
  ReviewEvent,
  TimelineMarkerEvent,
  TimelineWindow
} from '../../../data-access/frigate/adapter/frigate-adapter';
import { ReolinkEventService } from '../../../data-access/reolink/reolink-event.service';
import type { UiError } from '../../../shared/types/ui-error';
import { CameraWorkspaceStore } from '../../camera-workspace/state/camera-workspace.store';
import { ReviewStore } from '../../review-overlay/state/review.store';

export type TimelineDensityMode = 'coarse' | 'medium' | 'fine';

export type TimelineState = {
  windowStatus: 'idle' | 'loading' | 'ready' | 'error';
  loadedWindow: TimelineWindow | null;
  hoveredTimestampMs: number | null;
  scrubTimestampMs: number | null;
  pendingPreviewTimestampMs: number | null;
  previewStatus: 'idle' | 'loading' | 'ready' | 'error';
  previewFrame: PreviewFrame | null;
  densityMode: TimelineDensityMode;
  reviewEventCounts: Record<string, number>;
  markerEventCounts: Record<string, number>;
  error: UiError | null;
};

export const initialTimelineState: TimelineState = {
  windowStatus: 'idle',
  loadedWindow: null,
  hoveredTimestampMs: null,
  scrubTimestampMs: null,
  pendingPreviewTimestampMs: null,
  previewStatus: 'idle',
  previewFrame: null,
  densityMode: 'medium',
  reviewEventCounts: {},
  markerEventCounts: {},
  error: null
};

@Injectable({ providedIn: 'root' })
export class TimelineStore {
  private readonly frigateAdapter = inject(FRIGATE_ADAPTER);
  private readonly cameraWorkspaceStore = inject(CameraWorkspaceStore);
  private readonly reviewStore = inject(ReviewStore);
  private readonly reolinkEventService = inject(ReolinkEventService);
  private readonly previewDebounceMs = 150;

  private readonly state = signal<TimelineState>(initialTimelineState);
  private lastRequestKey: string | null = null;
  private lastPreviewKey: string | null = null;
  private previewDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private currentCameraId: string | null = null;
  private currentRangeStartMs: number | null = null;
  private currentRangeEndMs: number | null = null;
  private readonly pendingPreviewTimestamp = computed(
    () => this.state().pendingPreviewTimestampMs
  );

  readonly timelineState = this.state.asReadonly();

  constructor() {
    effect(() => {
      const workspace = this.cameraWorkspaceStore.cameraWorkspace();

      if (
        !workspace.selectedCameraId ||
        workspace.visibleRangeStartMs === null ||
        workspace.visibleRangeStartMs === undefined ||
        workspace.visibleRangeEndMs === null ||
        workspace.visibleRangeEndMs === undefined
      ) {
        return;
      }

      const requestKey = [
        workspace.selectedCameraId,
        workspace.visibleRangeStartMs,
        workspace.visibleRangeEndMs
      ].join(':');

      if (requestKey === this.lastRequestKey) {
        return;
      }

      this.lastRequestKey = requestKey;
      this.currentCameraId = workspace.selectedCameraId;
      this.currentRangeStartMs = workspace.visibleRangeStartMs;
      this.currentRangeEndMs = workspace.visibleRangeEndMs;
      void this.loadRecordingWindow(
        workspace.selectedCameraId,
        workspace.visibleRangeStartMs,
        workspace.visibleRangeEndMs
      );
    });

    this.reolinkEventService.events$.subscribe((event) => {
      if (!this.currentCameraId || this.currentRangeStartMs === null || this.currentRangeEndMs === null) {
        return;
      }

      if (event.cameraId !== this.currentCameraId) {
        return;
      }

      if (event.timestampMs < this.currentRangeStartMs || event.timestampMs > this.currentRangeEndMs) {
        return;
      }

      void this.loadRecordingWindow(
        this.currentCameraId,
        this.currentRangeStartMs,
        this.currentRangeEndMs
      );
    });

    effect(() => {
      const workspace = this.cameraWorkspaceStore.cameraWorkspace();
      const pendingPreviewTimestampMs = this.pendingPreviewTimestamp();

      if (!workspace.selectedCameraId || !pendingPreviewTimestampMs) {
        this.clearPreviewDebounceTimer();
        this.lastPreviewKey = null;
        this.state.update((state) => ({
          ...state,
          previewStatus: 'idle',
          previewFrame: null
        }));
        return;
      }

      const previewKey = `${workspace.selectedCameraId}:${pendingPreviewTimestampMs}`;

      if (previewKey === this.lastPreviewKey) {
        return;
      }

      this.schedulePreviewLoad(workspace.selectedCameraId, pendingPreviewTimestampMs, previewKey);
    });
  }

  async loadRecordingWindow(cameraId: string, startMs: number, endMs: number): Promise<void> {
    this.state.update((state) => ({
      ...state,
      windowStatus: 'loading',
      error: null
    }));

    try {
      const [segments, reviewEvents, mqttEvents] = await Promise.all([
        this.frigateAdapter.getRecordings({
          cameraId,
          startMs,
          endMs
        }),
        this.reviewStore.loadReviewEvents(cameraId, startMs, endMs),
        this.reolinkEventService.getEvents({
          cameraId,
          startMs,
          endMs
        })
      ]);

      const markerEvents = this.mergeMarkerEvents(reviewEvents, mqttEvents);

      this.state.update((state) => ({
        ...state,
        windowStatus: 'ready',
        densityMode: this.deriveDensityMode(segments, reviewEvents, mqttEvents),
        reviewEventCounts: this.countReviewEvents(reviewEvents),
        markerEventCounts: this.countMarkerEvents(markerEvents),
        loadedWindow: {
          requestStartMs: startMs,
          requestEndMs: endMs,
          loadedStartMs: startMs,
          loadedEndMs: endMs,
          segments: this.normalizeSegments(segments, startMs, endMs),
          reviewEvents,
          timelineMarkerEvents: markerEvents,
          gaps: this.calculateGaps(segments, startMs, endMs)
        }
      }));
    } catch {
      this.state.update((state) => ({
        ...state,
        windowStatus: 'error',
        error: {
          code: 'UNKNOWN_FAILURE',
          message: 'Unable to load recording metadata for the selected camera.',
          retryable: true
        }
      }));
    }
  }

  setHoveredTimestamp(timestampMs: number | null): void {
    const loadedWindow = this.state().loadedWindow;
    const previewTimestampMs =
      timestampMs !== null && loadedWindow && this.hasRecordingAtTimestamp(loadedWindow.segments, timestampMs)
        ? timestampMs
        : null;

    this.state.update((state) => ({
      ...state,
      hoveredTimestampMs: timestampMs,
      pendingPreviewTimestampMs: previewTimestampMs,
      previewFrame: previewTimestampMs === null ? null : state.previewFrame,
      previewStatus:
        previewTimestampMs === null
          ? 'idle'
          : previewTimestampMs === state.pendingPreviewTimestampMs
            ? state.previewStatus
            : 'loading'
    }));
  }

  setScrubTimestamp(timestampMs: number | null): void {
    this.state.update((state) => ({
      ...state,
      scrubTimestampMs: timestampMs
    }));
  }

  private async loadPreviewFrame(cameraId: string, timestampMs: number): Promise<void> {
    this.state.update((state) => ({
      ...state,
      previewStatus: 'loading'
    }));

    try {
      const previewFrame = await this.frigateAdapter.getPreviewFrame({
        cameraId,
        timestampMs,
        width: 320,
        height: 180
      });

      this.state.update((state) => ({
        ...state,
        previewStatus: previewFrame ? 'ready' : 'idle',
        previewFrame
      }));
    } catch {
      this.state.update((state) => ({
        ...state,
        previewStatus: 'error',
        previewFrame: null
      }));
    }
  }

  private schedulePreviewLoad(cameraId: string, timestampMs: number, previewKey: string): void {
    this.clearPreviewDebounceTimer();
    this.previewDebounceTimer = setTimeout(() => {
      this.previewDebounceTimer = null;
      this.lastPreviewKey = previewKey;
      void this.loadPreviewFrame(cameraId, timestampMs);
    }, this.previewDebounceMs);
  }

  private clearPreviewDebounceTimer(): void {
    if (this.previewDebounceTimer !== null) {
      clearTimeout(this.previewDebounceTimer);
      this.previewDebounceTimer = null;
    }
  }

  private normalizeSegments(
    segments: RecordingSegment[],
    startMs: number,
    endMs: number
  ): RecordingSegment[] {
    return segments
      .map((segment) => {
        const normalizedStartMs = Math.max(segment.startMs, startMs);
        const normalizedEndMs = Math.min(segment.endMs, endMs);

        return {
          ...segment,
          startMs: normalizedStartMs,
          endMs: normalizedEndMs,
          durationMs: Math.max(normalizedEndMs - normalizedStartMs, 0)
        };
      })
      .filter((segment) => segment.endMs > segment.startMs)
      .sort((left, right) => left.startMs - right.startMs);
  }

  private calculateGaps(
    segments: RecordingSegment[],
    startMs: number,
    endMs: number
  ): Array<{ startMs: number; endMs: number }> {
    const normalizedSegments = this.normalizeSegments(segments, startMs, endMs);
    const gaps: Array<{ startMs: number; endMs: number }> = [];
    let cursor = startMs;

    for (const segment of normalizedSegments) {
      if (segment.startMs > cursor) {
        gaps.push({
          startMs: cursor,
          endMs: segment.startMs
        });
      }

      cursor = Math.max(cursor, segment.endMs);
    }

    if (cursor < endMs) {
      gaps.push({
        startMs: cursor,
        endMs
      });
    }

    return gaps;
  }

  private hasRecordingAtTimestamp(segments: RecordingSegment[], timestampMs: number): boolean {
    return segments.some(
      (segment) => segment.startMs <= timestampMs && segment.endMs >= timestampMs
    );
  }

  private countReviewEvents(reviewEvents: ReviewEvent[]): Record<string, number> {
    return reviewEvents.reduce<Record<string, number>>((counts, reviewEvent) => {
      counts[reviewEvent.type] = (counts[reviewEvent.type] || 0) + 1;
      return counts;
    }, {});
  }

  private countMarkerEvents(markerEvents: TimelineMarkerEvent[]): Record<string, number> {
    return markerEvents.reduce<Record<string, number>>((counts, markerEvent) => {
      counts[markerEvent.type] = (counts[markerEvent.type] || 0) + 1;
      return counts;
    }, {});
  }

  private mergeMarkerEvents(
    reviewEvents: ReviewEvent[],
    mqttEvents: Array<{ id: string; cameraId: string; timestampMs: number; durationMs?: number; type: string; label?: string; confidence?: number; source: 'reolink-mqtt' }>
  ): TimelineMarkerEvent[] {
    const reviewMarkers: TimelineMarkerEvent[] = reviewEvents.map((reviewEvent) => ({
      id: reviewEvent.id,
      cameraId: reviewEvent.cameraId,
      startMs: reviewEvent.startMs,
      endMs: reviewEvent.endMs,
      type: reviewEvent.type,
      label: reviewEvent.label,
      severity: reviewEvent.severity,
      source: 'frigate'
    }));

    const mqttMarkers: TimelineMarkerEvent[] = mqttEvents.map((mqttEvent) => ({
      id: mqttEvent.id,
      cameraId: mqttEvent.cameraId,
      startMs: mqttEvent.timestampMs,
      endMs: mqttEvent.durationMs ? mqttEvent.timestampMs + mqttEvent.durationMs : mqttEvent.timestampMs,
      type: mqttEvent.type,
      label: mqttEvent.label,
      confidence: mqttEvent.confidence,
      source: 'reolink-mqtt'
    }));

    return [...reviewMarkers, ...mqttMarkers].sort((left, right) => left.startMs - right.startMs);
  }

  private deriveDensityMode(
    segments: RecordingSegment[],
    reviewEvents: ReviewEvent[],
    mqttEvents: Array<{ id: string; cameraId: string; timestampMs: number; durationMs?: number; type: string; label?: string; confidence?: number; source: 'reolink-mqtt' }>
  ): TimelineDensityMode {
    const score = segments.length + reviewEvents.length + mqttEvents.length;

    if (score > 120) {
      return 'coarse';
    }

    if (score > 40) {
      return 'medium';
    }

    return 'fine';
  }
}
