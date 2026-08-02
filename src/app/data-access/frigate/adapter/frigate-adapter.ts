export type CameraSummary = {
  id: string;
  name: string;
  enabled: boolean;
  timezone?: string;
  hasRecordings: boolean;
  hasReviewEvents: boolean;
};

export type RecordingSegment = {
  cameraId: string;
  startMs: number;
  endMs: number;
  durationMs: number;
  mediaPath: string;
  sourceKind: 'recording' | 'clip';
};

export type ReviewEvent = {
  id: string;
  cameraId: string;
  startMs: number;
  endMs: number;
  type: string;
  severity?: string;
  label?: string;
};

export type PreviewFrame = {
  cameraId: string;
  timestampMs: number;
  imageUrl: string;
  width?: number;
  height?: number;
};

export type TimelineMarkerEvent = {
  id: string;
  cameraId: string;
  startMs: number;
  endMs: number;
  type: string;
  label?: string;
  severity?: string;
  source: 'frigate' | 'reolink-mqtt';
  confidence?: number;
};

export type PlaybackSource = {
  cameraId: string;
  requestedTimestampMs: number;
  resolvedUrl: string;
  playableRangeStartMs: number;
  playableRangeEndMs: number;
  transport: 'mp4' | 'mse' | 'hls' | 'unknown';
};

export type TimelineWindow = {
  requestStartMs: number;
  requestEndMs: number;
  loadedStartMs: number;
  loadedEndMs: number;
  segments: RecordingSegment[];
  reviewEvents: ReviewEvent[];
  timelineMarkerEvents: TimelineMarkerEvent[];
  gaps: Array<{ startMs: number; endMs: number }>;
};

export type GetRecordingsInput = {
  cameraId: string;
  startMs: number;
  endMs: number;
};

export type GetReviewEventsInput = {
  cameraId: string;
  startMs: number;
  endMs: number;
  types?: string[];
  labels?: string[];
};

export type GetPreviewFrameInput = {
  cameraId: string;
  timestampMs: number;
  width?: number;
  height?: number;
};

export type ResolvePlaybackSourceInput = {
  cameraId: string;
  timestampMs: number;
  preferClip?: boolean;
};

export interface FrigateAdapter {
  getCameras(): Promise<CameraSummary[]>;
  getRecordings(input: GetRecordingsInput): Promise<RecordingSegment[]>;
  getReviewEvents(input: GetReviewEventsInput): Promise<ReviewEvent[]>;
  getPreviewFrame(input: GetPreviewFrameInput): Promise<PreviewFrame | null>;
  resolvePlaybackSource(input: ResolvePlaybackSourceInput): Promise<PlaybackSource | null>;
}
