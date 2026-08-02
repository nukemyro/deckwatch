Engineering & Architecture Design DocumentSystem Component: Low-Overhead Predictive Timeline Scrubber EngineImplementation Context: Frontend UI Layer paired with a Frigate NVR API backendTarget Template Integration: Angular-style declarative template with structural overlay controls1. Technical Architecture & State MachineTo enforce the speculative caching and stratified sampling behavior without locking up the browser main thread, the interface lifecycle must shift through four explicit mechanical states.

State DefinitionsSTATIONARY: The timeline scroller element (.timeline-scroller) is idle (scrollLeft is unchanged). The high-resolution video engine handles active video rendering. The frontend speculative engine continuously generates a 6-minute floating localized sliding window of low-overhead thumbnails directly into the browser's hardware memory cache.ACTIVE_SCRUB: Triggered immediately by the initial change in scrollLeft. The system flags isScrubbing = true, applies a visual blur/opacity drop to the master video container, and overlays a fast-path image preview canvas above the video viewport to handle high-velocity UI updates.VELOCITY_LOOP: Evaluated on every continuous scroll event frame. The layout calculation engine processes horizontal delta steps to gauge scrolling velocity. The network management engine dynamically adjusts fetching patterns—alternating between high-density local frames (slow scrubbing) and structural keyframe snapshots (fast macro scrubbing).SETTLED_SEEK: Triggered when the timeline container ceases movement for more than 150ms. The system calculates the absolute final layout coordinate, executes the Magnetic Snap routine to clamp the timeline to the nearest matching Frigate NVR event index, switches the display element back to the <video> engine, and commands a native high-resolution seek operation (video.currentTime = target).2. Declarative Template Event MappingThe operational structure map dictates how the provided HTML template bindings interface with the background runtime loops during user scrolling operations.

Handler Interaction Registry(pointerdown)="handleTimelinePointerDown()"Purpose: Captures the structural beginning of intentional scrubbing interactions on both mobile touch devices and desktop mice pointers.Operational Execution: Sets an internal layout flag userInteracting = true. It halts the predictive background pipeline to prevent asynchronous downloads from colliding with active interaction network streams.(scroll)="handleTimelineScroll($event)"Purpose: Captures native browser-driven container mutations. This acts as the single source of truth for tracking chronological advancement.Operational Execution: Calculates current scrolling velocity. Maps geometric canvas values (scrollLeft) to absolute historical timestamps, and targets cache assets or remote endpoint calls based on speed profiles.(pointerup)="handleTimelinePointerUp()" / (pointercancel)Purpose: Registers the conclusion of physical tracking input.Operational Execution: Relinquishes the interaction lockout loop (userInteracting = false). If the browser container momentum has dropped below threshold limits, this handler kicks off the evaluation pass for the Magnetic Snap routine to snap the closest event boundary under the center playhead indicator.3. Cache & Sampling Mechanics (Data Pipeline Design)The core efficiency engine relies on distinguishing spatial proximity from scroll velocity to optimize network layout loads.       
		 
Specification A: Speculative Predictive Buffer (Stationary Track)When the scroller settles into a STATIONARY baseline state, a background processing loop creates a dual-directional data buffer around the current centralized time variable (\(T_{0}\)).Window Metrics: Allocates a bounding scope from \((T_0 - 180\text{ seconds})\) through \((T_0 + 180\text{ seconds})\).Sampling Resolution: Captures discrete data targets exactly every 2,000 milliseconds (2 seconds).Network Transport Layout: Sends non-blocking, sequential batch thumbnail requests. Images are read as binary Blobs and held in an active memory key-value map layout indexed by their target epoch integer: Map<number, string>.Specification B: Velocity-Driven Stratified Sampling (Active Track)When active navigation events occur, the controller computes the interval step size by dividing the delta canvas offset by the elapsed execution frame time.\(\text{Velocity\ (V)}=\frac{|\text{scrollLeft}_{\text{current}}-\text{scrollLeft}_{\text{previous}}|}{\Delta \text{Time\ (seconds)}}\)1. Low Velocity Tier (Precise Crawl Mode)Trigger Threshold: \(V < 100\text{ pixels/second}\).Mechanic: The scrubber loops requests for immediate adjacent time offsets spaced 2 to 5 seconds apart. If the position target sits inside the initialized Speculative Cache map boundary, it paints the frame instantly with zero network cost. If it falls outside, it fires an isolated on-demand image fetch request.2. High Velocity Tier (Macro Scan Mode)Trigger Threshold: \(V \ge 100\text{ pixels/second}\).Mechanic: The system bypasses micro-granularity tracking. It jumps ahead along the scrolling vector trajectory, requesting frame snapshots spaced across a wide 60-second to 120-second (1–2 minute) sampling interval.The Abort Guard: To prevent browser networking thread lockouts while sweeping past hours of event history, every new high-velocity evaluation step executes .abort() on the previous frame cycle's AbortController instance before initializing the next asset fetch command.4. Geometric & Chronological Alignment FormulaeBecause the template exposes raw absolute timestamp ranges through attributes like [attr.aria-valuemin] and [attr.aria-valuemax], the component controller transforms layout pixels to relative timestamps using fixed scale factors.

Constant Configuration Specifications\(S_{f}\) (Scale Factor): 10 pixels/second (Configured so a 1-minute tracking span occupies 600 horizontal canvas pixels).\(W_{v}\) (Viewport Width): Obtained dynamically via timelineScroller.clientWidth.\(T_{min}\): The base value from loadedWindow().requestStartMs.Transformation 1: Resolving Time from Scroll MetricsWhen processing native (scroll) event payloads, calculate the target time currently residing underneath the absolute center indicator layer using the following equation:\(\text{Center\ Canvas\ Offset\ (Pixels)}=\text{scrollLeft}+\left(\frac{W_{v}}{2}\right)\)\(\text{Elapsed\ Track\ Seconds}=\frac{\text{Center\ Canvas\ Offset}}{S_{f}}\)\(\text{Selected\ Timestamp\ (Ms)}=T_{min}+(\text{Elapsed\ Track\ Seconds}\times 1000)\)Transformation 2: Setting Layout Positions from Time DataWhen initializing the default starting view state or applying the Magnetic Snap adjustment to focus on an NVR event match, map the target event time destination (\(T_{e}\)) back to the layout element using this equation:\(\text{Target\ Relative\ Seconds}=\frac{T_{e}-T_{min}}{1000}\)\(\text{Target\ Container\ scrollLeft}=(\text{Target\ Relative\ Seconds}\times S_{f})-\left(\frac{W_{v}}{2}\right)\)5. UI Layout Layering & Component ClassesTo achieve visual parity with Nest Cam mechanics without generating concrete codebase assets, apply the following structural layer arrangement specs across your stylesheet ecosystem:css/* Layout Stage Outer Box Containing the Center Indicator Alignments */

.timeline-stage {
  position: relative;
  overflow: hidden;
  width: 100%;
  height: 120px;
  background-color: #1a1a1a;
}

/* Fixed Center Indicator Line Component Overlayed directly over Scroll Tracks */
.timeline-center-indicator {
  position: absolute;
  left: 50%;
  top: 0;
  transform: translateX(-50%);
  width: 2px;
  height: 100%;
  background-color: #4285f4; /* Active Blueprint Blue */
  z-index: 100;
  pointer-events: none; /* Prevents layout blocks from intercepting scroll swipe gestures */
}

/* The Horizontal Scrolling Window Element */
.timeline-scroller {
  position: relative;
  display: flex;
  overflow-x: scroll;
  overflow-y: hidden;
  width: 100%;
  height: 100%;
  scroll-behavior: auto; /* Required: Smooth scrolling causes layout delay traps during high-speed tracks */
  -webkit-overflow-scrolling: touch; /* Stabilizes iOS kinetic track rendering mechanics */
}

/* Long Interior Structural Container Block */
.timeline-track {
  display: flex;
  position: relative;
  height: 100%;
  /* Dead zone padding layout matches exactly half of the viewport bounding box.
     This ensures the edge boundaries can sit directly under center playheads. */
  padding-left: 50%;
  padding-right: 50%;
  box-sizing: border-box;
}

/* Specialized Container Managing Overlay Placements for Frigate NVR Event Metrics */
.timeline-marker-layer {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

/* Individual Color-Coded Event Elements Extracted from data markers */
.timeline-marker-pill {
  position: absolute;
  height: 12px;
  top: 75%; /* Lower third horizon layout assignment */
  border: none;
  border-radius: 4px;
  background-color: #ff9800; /* Amber: Standard Person Detection */
  pointer-events: auto; /* Re-enables interaction focus clicks for quick jump operations */
}

.timeline-marker-pill--mqtt {
  background-color: #00e676; /* Green: Realtime Edge Signal Alerts */
}
Use code with caution.
