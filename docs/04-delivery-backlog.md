# Delivery Backlog

## Purpose

This backlog converts the phased delivery plan from `01-architectural.md` into execution-ready work items for the first implementation cycle.

The backlog is organized by milestone, with each item describing intent, dependencies, and completion criteria.

## Milestone 1: Foundation

### B1. Runtime configuration bootstrap

Objective:

- Load runtime configuration for direct and proxy deployment modes.

Deliverables:

- configuration loader
- typed runtime config contract
- startup failure state for invalid config

Dependencies:

- none

Done when:

- the app can start from runtime config without hardcoded Frigate URLs
- deployment mode and auth mode are available to the adapter layer

### B2. Frigate adapter skeleton

Objective:

- Establish the single integration boundary for all Frigate-facing requests.

Deliverables:

- adapter interface
- DTO mapper scaffolding
- transport client wrapper
- normalized error model

Dependencies:

- B1

Done when:

- components and feature services can depend on the adapter contract rather than endpoint strings
- transport errors classify into stable UI error codes

### B3. Application shell and route bootstrap

Objective:

- Create the Angular shell, route structure, and shared layout required for the browsing workflow.

Deliverables:

- application shell component
- primary route definition
- global error surface
- shared layout primitives

Dependencies:

- B1

Done when:

- the application can render a shell with initialized configuration and placeholder feature slots

### B4. Camera catalog and workspace store

Objective:

- Load cameras and establish the current browsing context.

Deliverables:

- camera workspace store
- camera selector component
- initial date and visible range selection logic
- persisted workspace preferences

Dependencies:

- B2
- B3

Done when:

- a default camera can be selected
- the workspace emits stable camera and date context to dependent features

## Milestone 2: Metadata browsing

### B5. Recordings query service

Objective:

- Fetch recording metadata for the active camera and time window.

Deliverables:

- recordings adapter implementation
- timeline query service
- recordings cache key strategy

Dependencies:

- B2
- B4

Done when:

- the app can resolve a normalized set of recording segments for a requested window
- empty ranges are represented distinctly from failures

### B6. Base timeline projection and canvas renderer

Objective:

- Render recording coverage over the selected time range.

Deliverables:

- timestamp projection service
- timeline canvas component
- scale and viewport math
- resize handling

Dependencies:

- B4
- B5

Done when:

- recording segments are visible on a scalable timeline
- redraw is bounded to viewport and data changes

### B7. Review events query and projection

Objective:

- Add review event metadata to the timeline surface.

Deliverables:

- review events adapter implementation
- review store
- marker projection service
- review filter state contract

Dependencies:

- B2
- B4
- B6

Done when:

- review markers render over the timeline without affecting base recording display
- review failures degrade locally without collapsing browsing

### B8. Loading, empty, and error states

Objective:

- Make metadata browsing resilient and interpretable.

Deliverables:

- loading placeholders
- empty-range states
- localized retry surfaces
- feature-level error banners or notices

Dependencies:

- B5
- B6
- B7

Done when:

- operators can distinguish no recordings from a failed request
- review and preview failures do not block core navigation

## Milestone 3: Playback integration

### B9. Playback state store and controller

Objective:

- Introduce state management for playback target and player lifecycle.

Deliverables:

- playback store
- video controller service
- player status state model

Dependencies:

- B4
- B6

Done when:

- timeline features can commit a target timestamp into a dedicated playback state flow

### B10. Playback source resolution

Objective:

- Resolve playable media for a selected timestamp.

Deliverables:

- playback source adapter implementation
- fallback logic for nearest valid segment
- playable range normalization

Dependencies:

- B2
- B5
- B9

Done when:

- a valid recording selection can resolve a playback source
- a gap selection produces a controlled unavailable or fallback state

### B11. Timeline-to-player synchronization

Objective:

- Keep the timeline and player aligned during seek and playback operations.

Deliverables:

- target timestamp commit flow
- pending seek indicator behavior
- player readiness handling
- visible range alignment for event and segment jumps

Dependencies:

- B6
- B9
- B10

Done when:

- selecting the timeline loads the player
- player readiness and playback state update the UI predictably

### B12. Preview frame workflow

Objective:

- Add lower-cost hover feedback before full playback resolution.

Deliverables:

- preview frame adapter implementation
- hover debounce and cancellation logic
- preview tooltip surface

Dependencies:

- B6
- B9

Done when:

- hover can request preview imagery without causing excessive network churn
- preview failure degrades gracefully to timestamp-only hover behavior

## Milestone 4: Hardening

### B13. Request cancellation and adjacent-window prefetch

Objective:

- Improve responsiveness under rapid navigation.

Deliverables:

- cancellable metadata requests
- adjacent-window prefetch policy
- cache eviction strategy

Dependencies:

- B5
- B7
- B10
- B12

Done when:

- outdated requests do not overwrite current state
- adjacent browsing reuses recent data when appropriate

### B14. Accessibility completion

Objective:

- Ensure the timeline and playback features remain usable beyond pointer interaction.

Deliverables:

- keyboard navigation for timeline stepping
- screen-reader labels for timeline status and player state
- focus behavior for review event selection

Dependencies:

- B6
- B7
- B11

Done when:

- core browsing and playback flows work via keyboard only

### B15. Telemetry hooks and debug instrumentation

Objective:

- Expose performance and failure signals from the client.

Deliverables:

- adapter timing hooks
- timeline render timing hooks
- playback resolution outcome hooks
- structured debug logging interface

Dependencies:

- B2
- B6
- B10

Done when:

- client behavior can be inspected without adding ad hoc logging inside components

### B16. Deployment mode verification

Objective:

- Validate direct and proxy deployments before release.

Deliverables:

- direct deployment checklist
- proxy deployment checklist
- config matrix validation
- documented known constraints

Dependencies:

- B1
- B2
- B10

Done when:

- both supported deployment modes have been exercised against representative environments

## Cross-cutting test backlog

### T1. Adapter mapping unit tests

- verify camera, recording, review, preview, and playback mappers

### T2. Timeline projection unit tests

- verify timestamp-to-pixel math, zoom behavior, and gap rendering calculations

### T3. Feature integration tests

- verify camera selection triggers metadata reload
- verify review filtering does not reset playback target incorrectly
- verify scrub release initiates playback resolution

### T4. End-to-end smoke scenarios

- browse a day of recordings
- jump from review marker to playback
- handle empty windows
- verify keyboard-only timeline navigation

## Suggested execution order

1. B1
2. B2
3. B3
4. B4
5. B5
6. B6
7. B8
8. B9
9. B10
10. B11
11. B7
12. B12
13. B13
14. B14
15. B15
16. B16

The ordering places review overlay after base playback readiness if the team needs an earlier vertical slice. If review-driven navigation is a release-critical requirement, swap B7 ahead of B10.

## Release slice recommendation

Recommended first demonstrable vertical slice:

- B1 through B6
- B9 through B11
- T1 through T3 for the touched areas

That slice yields a usable single-camera historical browser with timeline-driven playback, which is the minimum architectural proof before adding preview hardening and richer review overlays.