# Frigate Endpoint Mapping Appendix

## Purpose

This appendix maps frontend adapter operations to Frigate-facing API and media interactions for the historical browsing application described in `01-architectural.md` and `02-implementation-spec.md`.

The exact Frigate endpoint names can vary by deployment details and version nuances, so this document defines the adapter contract and the expected transport behavior. Implementation should confirm final request shapes against the target Frigate 0.17 deployment.

## Mapping rules

- Angular features never call Frigate endpoints directly.
- Only the Frigate adapter may construct request URLs.
- DTOs remain transport-specific and are mapped into frontend-owned domain models.
- If deployment requires a same-origin proxy, the proxy mirrors these operations and hides Frigate-specific auth or CORS concerns.

## Adapter-to-endpoint mapping table

| Adapter operation | Purpose | Expected request shape | Expected Frigate resource | Frontend output |
| --- | --- | --- | --- | --- |
| `getCameras()` | Load visible camera catalog | `GET` with no body | camera configuration or camera summary endpoint | `CameraSummary[]` |
| `getRecordings({ cameraId, startMs, endMs })` | Load historical recording segments for timeline rendering | `GET` with camera and time range query params | recordings listing endpoint | `RecordingSegment[]` |
| `getReviewEvents({ cameraId, startMs, endMs, types, labels })` | Load review metadata for timeline markers | `GET` with camera, time range, and optional filters | review/events listing endpoint | `ReviewEvent[]` |
| `getPreviewFrame({ cameraId, timestampMs, width, height })` | Resolve hover preview imagery | `GET` with camera, timestamp, and optional dimensions | preview, thumbnail, or snapshot-style endpoint | `PreviewFrame \| null` |
| `resolvePlaybackSource({ cameraId, timestampMs, preferClip })` | Resolve media for the requested playback target | `GET` or derived URL assembly using camera and timestamp | recording media path, clip endpoint, or stream resource | `PlaybackSource \| null` |

## Transport contract by operation

### 1. Camera catalog

Adapter method:

```ts
getCameras(): Promise<CameraSummary[]>
```

Transport expectation:

- Request method: `GET`
- Input: none
- Response should contain all enabled cameras relevant to the browsing UI

Mapping rules:

- Map Frigate camera key to `CameraSummary.id`.
- Map display label if present; otherwise fall back to camera key.
- Derive `hasRecordings` and `hasReviewEvents` conservatively when those capabilities are not explicit.

Failure handling:

- `401` maps to `AUTH_REQUIRED`.
- `403` maps to `ACCESS_DENIED`.
- transport timeout maps to `NETWORK_FAILURE`.

### 2. Recordings query

Adapter method:

```ts
getRecordings(input: GetRecordingsInput): Promise<RecordingSegment[]>
```

Transport expectation:

- Request method: `GET`
- Query parameters: camera identifier, start timestamp, end timestamp
- Response should return recording segments overlapping the requested window

Mapping rules:

- Convert all timestamps into epoch milliseconds inside the frontend domain model.
- Normalize partial overlap so a segment may begin before the requested range and still be included.
- Derive `durationMs` from normalized start and end values if Frigate does not provide duration directly.
- Preserve the original media locator or recording path for later playback resolution.

Failure handling:

- empty result set is not an error and should produce an empty array
- missing camera maps to `CAMERA_NOT_FOUND`
- network and parsing failures surface as `NETWORK_FAILURE` or `UNKNOWN_FAILURE`

### 3. Review events query

Adapter method:

```ts
getReviewEvents(input: GetReviewEventsInput): Promise<ReviewEvent[]>
```

Transport expectation:

- Request method: `GET`
- Query parameters: camera identifier, time range, optional event type filters, optional label filters
- Response should contain review or detection events relevant to the active timeline window

Mapping rules:

- Normalize event identifiers to strings.
- Map Frigate label, object, or severity-like fields into the frontend `type`, `label`, and optional `severity` fields.
- If event end time is absent, treat the event as instantaneous and set `endMs = startMs`.

Failure handling:

- review endpoint failure must not block recording display or playback
- auth and permission failures should remain visible at the review-feature level only

### 4. Preview frame resolution

Adapter method:

```ts
getPreviewFrame(input: GetPreviewFrameInput): Promise<PreviewFrame | null>
```

Transport expectation:

- Request method: `GET`
- Query parameters: camera identifier, target timestamp, optional width and height
- Response may be a direct image URL, a signed media URL, or binary image content transformed by a proxy

Mapping rules:

- If the target deployment returns binary content directly, the adapter or proxy should convert it into a browser-safe URL abstraction before exposing it to components.
- Return `null` when preview imagery is unsupported for a valid timestamp.
- The adapter should never throw solely because preview imagery is unavailable.

Failure handling:

- unsupported preview mode resolves to `null`
- transport error should be logged but should not break timeline interaction

### 5. Playback source resolution

Adapter method:

```ts
resolvePlaybackSource(input: ResolvePlaybackSourceInput): Promise<PlaybackSource | null>
```

Transport expectation:

- Request method: `GET` or URL resolution using previously loaded segment data
- Input: camera identifier, target timestamp, optional clip preference
- Response must allow the frontend to load media and determine the actual playable time window

Resolution rules:

- Prefer using the already loaded recording window when it can satisfy playback without an extra metadata call.
- If Frigate requires a dedicated media lookup, perform it inside the adapter.
- If the requested timestamp falls in a gap, resolve the nearest valid segment only when product behavior allows fallback.
- Return `null` when no playable source can be resolved.

Mapping rules:

- Expose `resolvedUrl` as the only URL consumed by playback components.
- Set `playableRangeStartMs` and `playableRangeEndMs` from the actual segment bounds, not the requested timestamp.
- Label `transport` according to the returned media type or resolver pathway.

Failure handling:

- no playable match maps to `PLAYBACK_SOURCE_UNAVAILABLE`
- permission failures remain actionable and should preserve current timeline position

## Proxy adaptation table

If a same-origin proxy is used, it should expose frontend-stable routes that mirror the adapter contract rather than leaking raw Frigate endpoint names into the Angular application.

Suggested proxy route layout:

| Proxy route | Mirrors adapter method | Purpose |
| --- | --- | --- |
| `GET /api/cameras` | `getCameras()` | camera catalog |
| `GET /api/recordings` | `getRecordings()` | timeline recording data |
| `GET /api/review-events` | `getReviewEvents()` | review marker data |
| `GET /api/preview-frame` | `getPreviewFrame()` | hover preview |
| `GET /api/playback-source` | `resolvePlaybackSource()` | playback source resolution |

## DTO mapping guidance

The frontend should keep DTO types local to the adapter layer.

Suggested adapter-internal DTO categories:

- `FrigateCameraDto`
- `FrigateRecordingDto`
- `FrigateReviewEventDto`
- `FrigatePreviewDto`
- `FrigatePlaybackLocatorDto`

Mapper responsibilities:

- validate required fields before exposing domain objects
- coerce timestamp formats into epoch milliseconds
- drop transport-only properties that are irrelevant to the UI
- preserve raw payloads only in debug telemetry, not in feature state

## Query parameter guidance

The adapter should normalize these input conventions regardless of the downstream Frigate format:

- all frontend timestamps enter the adapter as epoch milliseconds
- camera selection is always by canonical camera id string
- optional filters with empty arrays should be omitted from transport requests
- undefined preview dimensions should not emit meaningless query keys

## Caching guidance

The adapter and query services may cache transport results under these keys:

- camera catalog: singleton cache per session
- recordings: `cameraId + rangeStart + rangeEnd`
- review events: `cameraId + rangeStart + rangeEnd + filters`
- preview frames: `cameraId + timestamp bucket + dimensions`
- playback source: `cameraId + segment identity + target timestamp`

Cache invalidation expectations:

- switching deployment config invalidates all transport caches
- camera catalog can be refreshed manually or on app bootstrap only
- timeline caches should tolerate adjacent-window reuse but must invalidate when filters change

## Observability hooks

Every adapter operation should emit:

- operation name
- request start timestamp
- completion duration
- response outcome: success, empty, failure, fallback
- normalized error code when relevant

## Open verification items

These items must be confirmed against the target Frigate deployment before implementation is finalized:

- exact camera listing endpoint and response shape
- exact recordings query endpoint and time parameter format
- exact review events endpoint and filter semantics
- whether preview imagery is best sourced from snapshots, thumbnails, or derived clip seeks
- whether playback uses direct recording paths, clips, or an intermediary stream endpoint