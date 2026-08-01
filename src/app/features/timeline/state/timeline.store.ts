import { Injectable, effect, inject, signal } from '@angular/core';

import { FRIGATE_ADAPTER } from '../../../data-access/frigate/adapter/frigate-adapter.token';
import type { TimelineWindow } from '../../../data-access/frigate/adapter/frigate-adapter';
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
  densityMode: TimelineDensityMode;
  error: UiError | null;
};

export const initialTimelineState: TimelineState = {
  windowStatus: 'idle',
  loadedWindow: null,
  hoveredTimestampMs: null,
  scrubTimestampMs: null,
  pendingPreviewTimestampMs: null,
  densityMode: 'medium',
  error: null
};

@Injectable({ providedIn: 'root' })
export class TimelineStore {
  private readonly frigateAdapter = inject(FRIGATE_ADAPTER);
  private readonly cameraWorkspaceStore = inject(CameraWorkspaceStore);
  private readonly reviewStore = inject(ReviewStore);

  private readonly state = signal<TimelineState>(initialTimelineState);
  private lastRequestKey: string | null = null;

  readonly timelineState = this.state.asReadonly();

  constructor() {
    effect(() => {
      const workspace = this.cameraWorkspaceStore.cameraWorkspace();

      if (!workspace.selectedCameraId || !workspace.visibleRangeStartMs || !workspace.visibleRangeEndMs) {
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
      void this.loadRecordingWindow(
        workspace.selectedCameraId,
        workspace.visibleRangeStartMs,
        workspace.visibleRangeEndMs
      );
    });
  }

  async loadRecordingWindow(cameraId: string, startMs: number, endMs: number): Promise<void> {
    this.state.update((state) => ({
      ...state,
      windowStatus: 'loading',
      error: null
    }));

    try {
      const [segments, reviewEvents] = await Promise.all([
        this.frigateAdapter.getRecordings({
          cameraId,
          startMs,
          endMs
        }),
        this.reviewStore.loadReviewEvents(cameraId, startMs, endMs)
      ]);

      this.state.update((state) => ({
        ...state,
        windowStatus: 'ready',
        loadedWindow: {
          requestStartMs: startMs,
          requestEndMs: endMs,
          loadedStartMs: startMs,
          loadedEndMs: endMs,
          segments,
          reviewEvents,
          gaps: []
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
}