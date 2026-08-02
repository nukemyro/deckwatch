import { Injectable, computed, inject, signal } from '@angular/core';

import { FRIGATE_ADAPTER } from '../../../data-access/frigate/adapter/frigate-adapter.token';
import { CameraWorkspaceStore } from '../../camera-workspace/state/camera-workspace.store';
import type { ReviewEvent, TimelineMarkerEvent } from '../../../data-access/frigate/adapter/frigate-adapter';
import {
  ReolinkEventService,
  type ReolinkEventType,
  type ReolinkTimelineEvent
} from '../../../data-access/reolink/reolink-event.service';
import type { UiError } from '../../../shared/types/ui-error';

export type ReviewSourceFilter = 'all' | 'frigate' | 'reolink-mqtt';

export type ReviewState = {
  status: 'idle' | 'loading' | 'ready' | 'error';
  events: TimelineMarkerEvent[];
  sourceFilter: ReviewSourceFilter;
  selectedEventId: string | null;
  countsByType: Record<string, number>;
  error: UiError | null;
};

export const initialReviewState: ReviewState = {
  status: 'idle',
  events: [],
  sourceFilter: 'all',
  selectedEventId: null,
  countsByType: {},
  error: null
};

@Injectable({ providedIn: 'root' })
export class ReviewStore {
  private readonly frigateAdapter = inject(FRIGATE_ADAPTER);
  private readonly cameraWorkspaceStore = inject(CameraWorkspaceStore);
  private readonly reolinkEventService = inject(ReolinkEventService);

  private readonly state = signal<ReviewState>(initialReviewState);

  readonly reviewState = this.state.asReadonly();
  readonly filteredEvents = computed(() => {
    const state = this.reviewState();

    if (state.sourceFilter === 'all') {
      return state.events;
    }

    return state.events.filter((event) => event.source === state.sourceFilter);
  });
  readonly sourceCounts = computed(() => {
    const events = this.reviewState().events;

    return events.reduce(
      (counts, event) => {
        if (event.source === 'frigate') {
          counts.frigate += 1;
        }

        if (event.source === 'reolink-mqtt') {
          counts['reolink-mqtt'] += 1;
        }

        return counts;
      },
      {
        all: events.length,
        frigate: 0,
        'reolink-mqtt': 0
      }
    );
  });
  readonly activeFilters = computed(() => this.cameraWorkspaceStore.cameraWorkspace().reviewFilter);

  async loadReviewEvents(cameraId: string, startMs: number, endMs: number): Promise<ReviewEvent[]> {
    this.state.update((state) => ({
      ...state,
      status: 'loading',
      error: null
    }));

    try {
      const filterState = this.activeFilters();
      const reolinkTypes = this.toReolinkEventTypes(filterState.types);
      const [events, mqttEvents] = await Promise.all([
        this.frigateAdapter.getReviewEvents({
          cameraId,
          startMs,
          endMs,
          types: filterState.types,
          labels: filterState.labels
        }),
        this.reolinkEventService.getEvents({
          cameraId,
          startMs,
          endMs,
          types: reolinkTypes.length > 0 ? reolinkTypes : undefined,
          labels: filterState.labels
        })
      ]);

      const mergedEvents = this.mergeOverlayEvents(events, mqttEvents);
      const countsByType = mergedEvents.reduce<Record<string, number>>((counts, event) => {
        counts[event.type] = (counts[event.type] || 0) + 1;
        return counts;
      }, {});
      const selectedEventId = this.state().selectedEventId;
      const sourceFilter = this.state().sourceFilter;
      const visibleEvents =
        sourceFilter === 'all'
          ? mergedEvents
          : mergedEvents.filter((event) => event.source === sourceFilter);
      const hasSelectedEvent = selectedEventId !== null && visibleEvents.some((event) => event.id === selectedEventId);

      this.state.update((state) => ({
        ...state,
        status: 'ready',
        events: mergedEvents,
        selectedEventId: hasSelectedEvent ? selectedEventId : null,
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

  setSourceFilter(sourceFilter: ReviewSourceFilter): void {
    this.state.update((state) => {
      const visibleEvents =
        sourceFilter === 'all'
          ? state.events
          : state.events.filter((event) => event.source === sourceFilter);
      const hasSelectedEvent =
        state.selectedEventId !== null && visibleEvents.some((event) => event.id === state.selectedEventId);

      return {
        ...state,
        sourceFilter,
        selectedEventId: hasSelectedEvent ? state.selectedEventId : null
      };
    });
  }

  private toReolinkEventTypes(types: string[]): ReolinkEventType[] {
    const mappedTypes = types.reduce<ReolinkEventType[]>((accumulator, type) => {
      if (type === 'detection' || type === 'alarm' || type === 'motion' || type === 'unknown') {
        accumulator.push(type);
      }

      return accumulator;
    }, []);

    return Array.from(new Set(mappedTypes));
  }

  private mergeOverlayEvents(
    reviewEvents: ReviewEvent[],
    mqttEvents: ReolinkTimelineEvent[]
  ): TimelineMarkerEvent[] {
    const frigateEvents: TimelineMarkerEvent[] = reviewEvents.map((event) => ({
      id: event.id,
      cameraId: event.cameraId,
      startMs: event.startMs,
      endMs: event.endMs,
      type: event.type,
      label: event.label,
      severity: event.severity,
      source: 'frigate'
    }));

    const brokerEvents: TimelineMarkerEvent[] = mqttEvents.map((event) => ({
      id: event.id,
      cameraId: event.cameraId,
      startMs: event.timestampMs,
      endMs: event.durationMs ? event.timestampMs + event.durationMs : event.timestampMs,
      type: event.type,
      label: event.label,
      source: 'reolink-mqtt',
      confidence: event.confidence
    }));

    return [...frigateEvents, ...brokerEvents].sort((left, right) => right.startMs - left.startMs);
  }
}
