import type { TimelineWindow } from '../../../data-access/frigate/adapter/frigate-adapter';
import type { UiError } from '../../../shared/types/ui-error';

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