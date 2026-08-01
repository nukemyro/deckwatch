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