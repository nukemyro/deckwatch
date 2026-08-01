import { Injectable, computed, inject, signal } from '@angular/core';

import { FRIGATE_ADAPTER } from '../../../data-access/frigate/adapter/frigate-adapter.token';
import type { CameraSummary } from '../../../data-access/frigate/adapter/frigate-adapter';
import type { UiError } from '../../../shared/types/ui-error';

export type ReviewFilterState = {
  types: string[];
  labels: string[];
  includeMotion: boolean;
};

export type CameraWorkspaceState = {
  selectedCameraId: string | null;
  selectedDate: string;
  visibleRangeStartMs: number;
  visibleRangeEndMs: number;
  zoomLevel: number;
  reviewFilter: ReviewFilterState;
};

export const initialCameraWorkspaceState: CameraWorkspaceState = {
  selectedCameraId: null,
  selectedDate: new Date().toISOString().slice(0, 10),
  visibleRangeStartMs: 0,
  visibleRangeEndMs: 0,
  zoomLevel: 1,
  reviewFilter: {
    types: [],
    labels: [],
    includeMotion: true
  }
};

@Injectable({ providedIn: 'root' })
export class CameraWorkspaceStore {
  private readonly frigateAdapter = inject(FRIGATE_ADAPTER);
  private readonly minimumWindowMs = 15 * 60 * 1000;
  private readonly maximumZoomLevel = 16;

  private readonly state = signal<CameraWorkspaceState>(initialCameraWorkspaceState);
  private readonly camerasState = signal<CameraSummary[]>([]);
  private readonly loadingState = signal(false);
  private readonly errorState = signal<UiError | null>(null);

  readonly cameraWorkspace = this.state.asReadonly();
  readonly cameras = this.camerasState.asReadonly();
  readonly isLoading = this.loadingState.asReadonly();
  readonly error = this.errorState.asReadonly();
  readonly selectedCamera = computed(() => {
    const selectedCameraId = this.state().selectedCameraId;
    return this.camerasState().find((camera) => camera.id === selectedCameraId) ?? null;
  });

  constructor() {
    this.syncVisibleRangeToSelectedDate();
  }

  async loadCameras(): Promise<void> {
    this.loadingState.set(true);
    this.errorState.set(null);

    try {
      const cameras = await this.frigateAdapter.getCameras();
      this.camerasState.set(cameras);

      if (!this.state().selectedCameraId && cameras.length > 0) {
        this.state.update((state) => ({
          ...state,
          selectedCameraId: cameras[0].id
        }));
      }
    } catch {
      this.errorState.set({
        code: 'UNKNOWN_FAILURE',
        message: 'Unable to load camera catalog.',
        retryable: true
      });
    } finally {
      this.loadingState.set(false);
    }
  }

  selectCamera(cameraId: string): void {
    this.state.update((state) => ({
      ...state,
      selectedCameraId: cameraId
    }));
  }

  setSelectedDate(selectedDate: string): void {
    this.state.update((state) => ({
      ...state,
      selectedDate
    }));

    this.syncVisibleRangeToSelectedDate();
  }

  shiftVisibleRange(direction: 'backward' | 'forward'): void {
    const state = this.state();
    const windowDurationMs = state.visibleRangeEndMs - state.visibleRangeStartMs;
    const deltaMs = direction === 'forward' ? windowDurationMs : -windowDurationMs;
    const dayBounds = this.getDayBounds(state.selectedDate);

    this.updateVisibleRange(
      state.visibleRangeStartMs + deltaMs,
      state.visibleRangeEndMs + deltaMs,
      dayBounds.startMs,
      dayBounds.endMs
    );
  }

  zoomVisibleRange(direction: 'in' | 'out'): void {
    const state = this.state();
    const nextZoomLevel =
      direction === 'in'
        ? Math.min(state.zoomLevel * 2, this.maximumZoomLevel)
        : Math.max(state.zoomLevel / 2, 1);

    if (nextZoomLevel === state.zoomLevel) {
      return;
    }

    const dayBounds = this.getDayBounds(state.selectedDate);
    const dayDurationMs = dayBounds.endMs - dayBounds.startMs;
    const requestedWindowDurationMs = Math.max(dayDurationMs / nextZoomLevel, this.minimumWindowMs);
    const currentCenterMs = state.visibleRangeStartMs + (state.visibleRangeEndMs - state.visibleRangeStartMs) / 2;

    this.state.update((previousState) => ({
      ...previousState,
      zoomLevel: nextZoomLevel
    }));

    this.updateVisibleRange(
      currentCenterMs - requestedWindowDurationMs / 2,
      currentCenterMs + requestedWindowDurationMs / 2,
      dayBounds.startMs,
      dayBounds.endMs
    );
  }

  private syncVisibleRangeToSelectedDate(): void {
    const state = this.state();
    const dayBounds = this.getDayBounds(state.selectedDate);
    const dayDurationMs = dayBounds.endMs - dayBounds.startMs;
    const windowDurationMs = Math.max(dayDurationMs / state.zoomLevel, this.minimumWindowMs);

    this.updateVisibleRange(
      dayBounds.startMs,
      dayBounds.startMs + windowDurationMs,
      dayBounds.startMs,
      dayBounds.endMs
    );
  }

  private updateVisibleRange(
    requestedStartMs: number,
    requestedEndMs: number,
    dayStartMs: number,
    dayEndMs: number
  ): void {
    const requestedDurationMs = Math.min(requestedEndMs - requestedStartMs, dayEndMs - dayStartMs);
    let visibleRangeStartMs = requestedStartMs;
    let visibleRangeEndMs = requestedEndMs;

    if (visibleRangeStartMs < dayStartMs) {
      visibleRangeStartMs = dayStartMs;
      visibleRangeEndMs = dayStartMs + requestedDurationMs;
    }

    if (visibleRangeEndMs > dayEndMs) {
      visibleRangeEndMs = dayEndMs;
      visibleRangeStartMs = dayEndMs - requestedDurationMs;
    }

    this.state.update((state) => ({
      ...state,
      visibleRangeStartMs,
      visibleRangeEndMs
    }));
  }

  private getDayBounds(selectedDate: string): { startMs: number; endMs: number } {
    const startMs = new Date(`${selectedDate}T00:00:00.000Z`).getTime();
    return {
      startMs,
      endMs: startMs + 86_400_000
    };
  }
}