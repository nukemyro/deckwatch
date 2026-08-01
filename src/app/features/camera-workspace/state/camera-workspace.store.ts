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