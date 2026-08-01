import { Injectable, computed, inject, signal } from '@angular/core';

import { FRIGATE_ADAPTER } from '../../../data-access/frigate/adapter/frigate-adapter.token';
import { CameraWorkspaceStore } from '../../camera-workspace/state/camera-workspace.store';
import type { ReviewEvent } from '../../../data-access/frigate/adapter/frigate-adapter';
import type { UiError } from '../../../shared/types/ui-error';

export type ReviewState = {
  status: 'idle' | 'loading' | 'ready' | 'error';
  events: ReviewEvent[];
  selectedEventId: string | null;
  countsByType: Record<string, number>;
  error: UiError | null;
};

export const initialReviewState: ReviewState = {
  status: 'idle',
  events: [],
  selectedEventId: null,
  countsByType: {},
  error: null
};

@Injectable({ providedIn: 'root' })
export class ReviewStore {
  private readonly frigateAdapter = inject(FRIGATE_ADAPTER);
  private readonly cameraWorkspaceStore = inject(CameraWorkspaceStore);

  private readonly state = signal<ReviewState>(initialReviewState);

  readonly reviewState = this.state.asReadonly();
  readonly activeFilters = computed(() => this.cameraWorkspaceStore.cameraWorkspace().reviewFilter);

  async loadReviewEvents(cameraId: string, startMs: number, endMs: number): Promise<ReviewEvent[]> {
    this.state.update((state) => ({
      ...state,
      status: 'loading',
      error: null
    }));

    try {
      const filterState = this.activeFilters();
      const events = await this.frigateAdapter.getReviewEvents({
        cameraId,
        startMs,
        endMs,
        types: filterState.types,
        labels: filterState.labels
      });

      const countsByType = events.reduce<Record<string, number>>((counts, event) => {
        counts[event.type] = (counts[event.type] || 0) + 1;
        return counts;
      }, {});

      this.state.update((state) => ({
        ...state,
        status: 'ready',
        events,
        countsByType
      }));

      return events;
    } catch {
      this.state.update((state) => ({
        ...state,
        status: 'error',
        error: {
          code: 'UNKNOWN_FAILURE',
          message: 'Unable to load review events for the selected camera.',
          retryable: true
        }
      }));

      return [];
    }
  }

  selectEvent(eventId: string | null): void {
    this.state.update((state) => ({
      ...state,
      selectedEventId: eventId
    }));
  }
}