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

  private syncVisibleRangeToSelectedDate(): void {
    this.state.update((state) => {
      const startOfDay = new Date(`${state.selectedDate}T00:00:00.000Z`).getTime();
      return {
        ...state,
        visibleRangeStartMs: startOfDay,
        visibleRangeEndMs: startOfDay + 86_400_000
      };
    });
  }
}