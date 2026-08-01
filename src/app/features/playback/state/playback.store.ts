import { Injectable, effect, inject, signal } from '@angular/core';

import { FRIGATE_ADAPTER } from '../../../data-access/frigate/adapter/frigate-adapter.token';
import { CameraWorkspaceStore } from '../../camera-workspace/state/camera-workspace.store';
import type { PlaybackSource } from '../../../data-access/frigate/adapter/frigate-adapter';
import type { UiError } from '../../../shared/types/ui-error';

export type PlaybackState = {
  targetTimestampMs: number | null;
  resolvedSource: PlaybackSource | null;
  playerStatus: 'idle' | 'resolving' | 'loading' | 'ready' | 'playing' | 'error';
  playableRangeStartMs: number | null;
  playableRangeEndMs: number | null;
  pendingSeekTimestampMs: number | null;
  error: UiError | null;
};

export const initialPlaybackState: PlaybackState = {
  targetTimestampMs: null,
  resolvedSource: null,
  playerStatus: 'idle',
  playableRangeStartMs: null,
  playableRangeEndMs: null,
  pendingSeekTimestampMs: null,
  error: null
};

@Injectable({ providedIn: 'root' })
export class PlaybackStore {
  private readonly frigateAdapter = inject(FRIGATE_ADAPTER);
  private readonly cameraWorkspaceStore = inject(CameraWorkspaceStore);

  private readonly state = signal<PlaybackState>(initialPlaybackState);
  private lastRequestKey: string | null = null;

  readonly playbackState = this.state.asReadonly();

  constructor() {
    effect(() => {
      const targetTimestampMs = this.state().targetTimestampMs;
      const selectedCameraId = this.cameraWorkspaceStore.cameraWorkspace().selectedCameraId;

      if (!targetTimestampMs || !selectedCameraId) {
        return;
      }

      const requestKey = `${selectedCameraId}:${targetTimestampMs}`;

      if (requestKey === this.lastRequestKey) {
        return;
      }

      this.lastRequestKey = requestKey;
      void this.resolvePlaybackSource(selectedCameraId, targetTimestampMs);
    });
  }

  setTargetTimestamp(timestampMs: number | null): void {
    this.state.update((state) => ({
      ...state,
      targetTimestampMs: timestampMs,
      pendingSeekTimestampMs: timestampMs,
      error: null
    }));
  }

  private async resolvePlaybackSource(cameraId: string, timestampMs: number): Promise<void> {
    this.state.update((state) => ({
      ...state,
      playerStatus: 'resolving',
      error: null
    }));

    try {
      const resolvedSource = await this.frigateAdapter.resolvePlaybackSource({
        cameraId,
        timestampMs
      });

      if (!resolvedSource) {
        this.state.update((state) => ({
          ...state,
          playerStatus: 'error',
          resolvedSource: null,
          playableRangeStartMs: null,
          playableRangeEndMs: null,
          error: {
            code: 'PLAYBACK_SOURCE_UNAVAILABLE',
            message: 'No playable media source is available for the selected timestamp.',
            retryable: true
          }
        }));
        return;
      }

      this.state.update((state) => ({
        ...state,
        playerStatus: 'ready',
        resolvedSource,
        playableRangeStartMs: resolvedSource.playableRangeStartMs,
        playableRangeEndMs: resolvedSource.playableRangeEndMs,
        pendingSeekTimestampMs: null,
        error: null
      }));
    } catch {
      this.state.update((state) => ({
        ...state,
        playerStatus: 'error',
        resolvedSource: null,
        playableRangeStartMs: null,
        playableRangeEndMs: null,
        error: {
          code: 'UNKNOWN_FAILURE',
          message: 'Unable to resolve playback media for the selected timestamp.',
          retryable: true
        }
      }));
    }
  }
}