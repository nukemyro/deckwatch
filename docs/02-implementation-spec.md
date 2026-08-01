# Frigate Angular Frontend Implementation Specification

## Purpose

This document converts the architectural plan in `01-architectural.md` into an implementation-oriented specification for the first production iteration.

The target is an Angular application that supports historical camera browsing, timeline scrubbing, preview display, and playback against Frigate 0.17 through a dedicated adapter boundary.

## Scope

This specification covers:

- Angular project structure.
- Feature boundaries.
- State store shape.
- Adapter method signatures.
- Timeline interaction contract.
- Deployment configuration contract.
- Testing targets for the first implementation pass.

This specification does not define visual design details beyond the interaction behaviors required by the architecture.

## Proposed Angular structure

The application should use standalone Angular APIs and organize code by feature slice rather than by framework artifact type alone.

```text
src/
  app/
    app.component.ts
    app.routes.ts
    core/
      bootstrap/
      config/
      error/
      telemetry/
    shared/
      ui/
      util/
      types/
    features/
      camera-workspace/
        components/
        state/
        services/
      timeline/
        components/
        canvas/
        state/
        services/
      playback/
        components/
        state/
        services/
      review-overlay/
        components/
        state/
        services/
    data-access/
      frigate/
        adapter/
        mappers/
        dto/
        media/
      cache/
    testing/
      fixtures/
      mocks/
```

## Module and responsibility map

### Core

The `core` area contains application-wide concerns:

- bootstrap of runtime configuration
- global error classification and presentation
- telemetry interfaces and noop/default implementations
- auth and header policy if required by deployment mode

### Shared

The `shared` area contains reusable primitives that do not own Frigate-specific domain behavior:

- date and time helpers
- range and viewport math helpers
- keyboard interaction utilities
- presentational UI atoms
- shared TypeScript utility types

### Camera workspace feature

This feature owns the current camera context and browsing window:

- selected camera id
- active date
- active visible time range
- user preferences for zoom and filters

Primary components:

- `camera-selector`
- `workspace-header`
- `date-window-controls`

Primary services:

- `camera-workspace-store`
- `camera-preferences-service`

### Timeline feature

This feature owns timeline rendering and scrubbing behavior:

- recording lane rendering
- event marker rendering
- hover and scrub state
- zoom and viewport math
- preview request scheduling

Primary components:

- `timeline-shell`
- `timeline-canvas`
- `timeline-scale`
- `timeline-tooltip`

Primary services:

- `timeline-store`
- `timeline-layout-service`
- `timeline-query-service`
- `preview-scheduler-service`

### Playback feature

This feature owns playback source resolution and video synchronization:

- active playback request
- playable window state
- current media source
- pending seek state
- fallback handling when target timestamp is outside available media

Primary components:

- `playback-panel`
- `video-player`
- `playback-status`

Primary services:

- `playback-store`
- `playback-controller-service`
- `playback-resolution-service`

### Review overlay feature

This feature owns review event filtering, projection, and selection:

- event fetch coordination
- marker projection into timeline coordinates
- filter state
- jump-to-event behavior

Primary components:

- `review-filter-bar`
- `review-marker-layer`
- `review-event-summary`

Primary services:

- `review-store`
- `review-query-service`
- `review-projection-service`

## State management approach

Use Angular signals for local and derived state, with RxJS reserved for asynchronous transport flows, cancellation, and event streams emitted by the media element.

The implementation should avoid a heavyweight global store unless future scope demands it. A feature-store pattern is sufficient for the initial release.

### Global app state shape

```ts
type AppConfigState = {
  frigateBaseUrl: string;
  proxyBaseUrl?: string;
  authMode: 'none' | 'header' | 'cookie';
  deploymentMode: 'direct' | 'proxy';
  featureFlags: {
    previewFrames: boolean;
    reviewOverlay: boolean;
    groupedTimeline: boolean;
  };
};
```

### Camera workspace state

```ts
type ReviewFilterState = {
  types: string[];
  labels: string[];
  includeMotion: boolean;
};

type CameraWorkspaceState = {
  selectedCameraId: string | null;
  selectedDate: string;
  visibleRangeStartMs: number;
  visibleRangeEndMs: number;
  zoomLevel: number;
  reviewFilter: ReviewFilterState;
};
```

### Timeline state

```ts
type TimelineState = {
  windowStatus: 'idle' | 'loading' | 'ready' | 'error';
  loadedWindow: TimelineWindow | null;
  hoveredTimestampMs: number | null;
  scrubTimestampMs: number | null;
  pendingPreviewTimestampMs: number | null;
  densityMode: 'coarse' | 'medium' | 'fine';
  error: UiError | null;
};
```

### Playback state

```ts
type PlaybackState = {
  targetTimestampMs: number | null;
  resolvedSource: PlaybackSource | null;
  playerStatus: 'idle' | 'resolving' | 'loading' | 'ready' | 'playing' | 'error';
  playableRangeStartMs: number | null;
  playableRangeEndMs: number | null;
  pendingSeekTimestampMs: number | null;
  error: UiError | null;
};
```

### Review state

```ts
type ReviewState = {
  status: 'idle' | 'loading' | 'ready' | 'error';
  events: ReviewEvent[];
  selectedEventId: string | null;
  countsByType: Record<string, number>;
  error: UiError | null;
};
```

## Domain contracts

The frontend should own stable domain contracts and keep Frigate DTOs separate.

```ts
type CameraSummary = {
  id: string;
  name: string;
  enabled: boolean;
  timezone?: string;
  hasRecordings: boolean;
  hasReviewEvents: boolean;
};

type RecordingSegment = {
  cameraId: string;
  startMs: number;
  endMs: number;
  durationMs: number;
  mediaPath: string;
  sourceKind: 'recording' | 'clip';
};

type ReviewEvent = {
  id: string;
  cameraId: string;
  startMs: number;
  endMs: number;
  type: string;
  severity?: string;
  label?: string;
};

type PreviewFrame = {
  cameraId: string;
  timestampMs: number;
  imageUrl: string;
  width?: number;
  height?: number;
};

type PlaybackSource = {
  cameraId: string;
  requestedTimestampMs: number;
  resolvedUrl: string;
  playableRangeStartMs: number;
  playableRangeEndMs: number;
  transport: 'mp4' | 'mse' | 'hls' | 'unknown';
};

type TimelineWindow = {
  requestStartMs: number;
  requestEndMs: number;
  loadedStartMs: number;
  loadedEndMs: number;
  segments: RecordingSegment[];
  reviewEvents: ReviewEvent[];
  gaps: Array<{ startMs: number; endMs: number }>;
};
```

## Frigate adapter contract

The adapter is the only layer allowed to know Frigate endpoint details.

```ts
interface FrigateAdapter {
  getCameras(): Promise<CameraSummary[]>;
  getRecordings(input: GetRecordingsInput): Promise<RecordingSegment[]>;
  getReviewEvents(input: GetReviewEventsInput): Promise<ReviewEvent[]>;
  getPreviewFrame(input: GetPreviewFrameInput): Promise<PreviewFrame | null>;
  resolvePlaybackSource(input: ResolvePlaybackSourceInput): Promise<PlaybackSource | null>;
}
```

Supporting input contracts:

```ts
type GetRecordingsInput = {
  cameraId: string;
  startMs: number;
  endMs: number;
};

type GetReviewEventsInput = {
  cameraId: string;
  startMs: number;
  endMs: number;
  types?: string[];
  labels?: string[];
};

type GetPreviewFrameInput = {
  cameraId: string;
  timestampMs: number;
  width?: number;
  height?: number;
};

type ResolvePlaybackSourceInput = {
  cameraId: string;
  timestampMs: number;
  preferClip?: boolean;
};
```

## Service interaction contract

### Load workspace

1. App bootstrap loads runtime config.
2. Camera workspace requests camera catalog.
3. First enabled camera becomes default selection unless route state overrides it.
4. The workspace store sets the initial visible window for the selected date.
5. Timeline and review queries execute from the derived camera and range state.

### Scrub interaction

1. Pointer movement updates hover state.
2. Pointer drag updates scrub state.
3. Scrub state schedules preview lookup with debounce.
4. Pointer release commits playback target.
5. Playback feature resolves media and loads the source.

### Review event jump

1. User selects a review marker or list item.
2. Review feature emits target timestamp.
3. Camera workspace ensures the timestamp is visible in the current window.
4. Playback target updates.
5. Playback resolution begins.

## Timeline interaction contract

The timeline must follow these behavioral rules:

- Left click on a segment commits a playback target timestamp.
- Drag across the timeline updates a scrub cursor continuously but resolves playback only on release.
- Hover may request preview imagery, but only for the latest hovered timestamp after debounce.
- Mouse wheel or gesture zoom keeps the cursor-centered timestamp stable.
- Keyboard left and right step by a small interval.
- Keyboard shift plus left and right step by a larger interval.
- Home and End jump to visible range bounds.
- Empty gaps remain interactive and should offer nearest recording fallback on selection.

## Rendering strategy

The initial timeline renderer should be canvas-based for the data lane and DOM-based for accessible overlays.

Implementation requirements:

- One canvas for recording segments and gaps.
- One overlay layer for review markers and focusable controls.
- One tooltip portal for hover metadata and preview frames.
- One projection service that maps timestamp to x-coordinate and x-coordinate to timestamp.

The renderer should recalculate only when:

- viewport width changes
- visible time range changes
- loaded recording or review data changes
- hover or scrub selection changes

## Error model

The UI should classify transport and domain failures into a stable error model.

```ts
type UiErrorCode =
  | 'AUTH_REQUIRED'
  | 'ACCESS_DENIED'
  | 'CAMERA_NOT_FOUND'
  | 'NO_DATA_IN_RANGE'
  | 'PLAYBACK_SOURCE_UNAVAILABLE'
  | 'NETWORK_FAILURE'
  | 'UNKNOWN_FAILURE';

type UiError = {
  code: UiErrorCode;
  message: string;
  retryable: boolean;
};
```

## Runtime configuration contract

The application should load configuration from a runtime source rather than compiling environment-specific values into the bundle.

```ts
type RuntimeConfig = {
  frigateBaseUrl: string;
  proxyBaseUrl?: string;
  deploymentMode: 'direct' | 'proxy';
  authMode: 'none' | 'header' | 'cookie';
  previewFramesEnabled: boolean;
  reviewOverlayEnabled: boolean;
  requestTimeoutMs: number;
};
```

Expected configuration behavior:

- `direct` mode sends browser requests to Frigate-hosted endpoints.
- `proxy` mode resolves all API and media URLs through the configured proxy.
- auth mode selects whether credentials come from cookies or adapter-attached headers.

## Testing targets

### Unit

- Mapper coverage for each adapter response shape.
- Timeline projection and bucketing math.
- Playback fallback selection logic.
- Error classification behavior.

### Integration

- Selecting a camera loads a timeline window.
- Scrubbing schedules preview requests without over-fetching.
- Clicking a review marker updates playback state.
- Empty ranges render correctly without playback regression.

### End-to-end

- Historical browse from camera selection to playback.
- Review event jump to playback.
- Preview degradation when preview endpoint is unavailable.
- Keyboard-only navigation through the timeline.

## Implementation order

1. Runtime config bootstrap and adapter skeleton.
2. Camera workspace store and camera loading flow.
3. Recording query and base timeline renderer.
4. Review overlay query and marker rendering.
5. Playback source resolution and video synchronization.
6. Preview frame scheduling.
7. Error handling, telemetry hooks, and performance tuning.

## Acceptance criteria for this specification

The first implementation should be considered architecture-compliant when:

- no component calls Frigate endpoints directly
- timeline, review, and playback behaviors consume typed domain contracts
- timeline selection can resolve playback for a valid recording window
- empty and failed states are visibly distinct
- direct and proxy deployment modes are both supported by configuration