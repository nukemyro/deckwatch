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