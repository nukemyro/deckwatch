import {
  AfterViewInit,
  Component,
  ElementRef,
  ViewChild,
  effect,
  input,
  output
} from '@angular/core';

import type { PreviewFrame, ReviewEvent, TimelineWindow } from '../../../data-access/frigate/adapter/frigate-adapter';

@Component({
  selector: 'app-timeline-canvas',
  standalone: true,
  template: `
    <div class="timeline-frame">
      <canvas
        #canvas
        class="timeline-canvas"
        tabindex="0"
        aria-label="Timeline visualization"
      ></canvas>
      @if (hoveredTimestamp() !== null) {
        <div class="timeline-tooltip" [style.left.%]="tooltipLeft()">
          @if (previewFrame()?.imageUrl; as imageUrl) {
            <img [src]="imageUrl" alt="Preview frame" />
          } @else {
            <div class="timeline-tooltip-placeholder">Preview unavailable</div>
          }
          <p>{{ hoveredTimestamp() }}</p>
        </div>
      }
      <div class="timeline-legend">
        <span><i class="segment"></i> Recording segment</span>
        <span><i class="gap"></i> Gap</span>
        <span><i class="event"></i> Review event</span>
      </div>
    </div>
  `,
  styles: `
    .timeline-frame {
      border: 1px solid rgba(23, 49, 59, 0.12);
      border-radius: 1rem;
      background: linear-gradient(180deg, rgba(255, 253, 250, 0.95), rgba(244, 248, 248, 0.95));
      padding: 1rem;
      position: relative;
    }

    .timeline-canvas {
      display: block;
      width: 100%;
      height: 180px;
      outline: none;
    }

    .timeline-canvas:focus-visible {
      box-shadow: 0 0 0 3px rgba(79, 143, 176, 0.25);
      border-radius: 0.85rem;
    }

    .timeline-tooltip {
      position: absolute;
      top: 0.95rem;
      transform: translateX(-50%);
      width: 180px;
      border: 1px solid rgba(23, 49, 59, 0.12);
      border-radius: 0.85rem;
      background: rgba(255, 255, 255, 0.96);
      box-shadow: 0 18px 40px rgba(35, 58, 64, 0.18);
      overflow: hidden;
      pointer-events: none;
    }

    .timeline-tooltip img,
    .timeline-tooltip-placeholder {
      display: block;
      width: 100%;
      height: 100px;
      object-fit: cover;
      background: #e4eded;
    }

    .timeline-tooltip-placeholder {
      display: grid;
      place-items: center;
      color: rgba(23, 49, 59, 0.64);
      font-size: 0.9rem;
    }

    .timeline-tooltip p {
      margin: 0;
      padding: 0.55rem 0.7rem;
      color: #17313b;
      font-size: 0.9rem;
      font-weight: 600;
    }

    .timeline-legend {
      display: flex;
      flex-wrap: wrap;
      gap: 1rem;
      margin-top: 0.85rem;
      color: rgba(23, 49, 59, 0.72);
      font-size: 0.92rem;
    }

    .timeline-legend span {
      display: inline-flex;
      align-items: center;
      gap: 0.45rem;
    }

    .timeline-legend i {
      display: inline-block;
      width: 0.9rem;
      height: 0.9rem;
      border-radius: 999px;
    }

    .timeline-legend .segment {
      background: #d77742;
    }

    .timeline-legend .gap {
      background: #d8e4e6;
      border: 1px solid rgba(23, 49, 59, 0.12);
    }

    .timeline-legend .event {
      background: #4f8fb0;
    }
  `
})
export class TimelineCanvasComponent implements AfterViewInit {
  readonly loadedWindow = input<TimelineWindow | null>(null);
  readonly selectedReviewEventId = input<string | null>(null);
  readonly hoveredTimestamp = input<number | null>(null);
  readonly previewFrame = input<PreviewFrame | null>(null);
  readonly hoverTimestampChange = output<number | null>();
  readonly scrubTimestampChange = output<number | null>();
  readonly timelineSelect = output<number>();
  readonly reviewEventSelect = output<string | null>();

  @ViewChild('canvas') private canvasRef?: ElementRef<HTMLCanvasElement>;

  private isViewReady = false;
  private isScrubbing = false;

  constructor() {
    effect(() => {
      this.loadedWindow();
      this.selectedReviewEventId();
      this.hoveredTimestamp();
      this.previewFrame();

      if (this.isViewReady) {
        queueMicrotask(() => this.draw());
      }
    });
  }

  ngAfterViewInit(): void {
    this.isViewReady = true;
    this.bindCanvasEvents();
    this.draw();
  }

  private bindCanvasEvents(): void {
    const canvas = this.canvasRef?.nativeElement;

    if (!canvas) {
      return;
    }

    canvas.addEventListener('pointerdown', (event) => this.handlePointerDown(event));
    canvas.addEventListener('pointermove', (event) => this.handlePointerMove(event));
    canvas.addEventListener('pointerup', (event) => this.handlePointerUp(event));
    canvas.addEventListener('pointerleave', () => this.handlePointerLeave());
    canvas.addEventListener('pointercancel', () => this.stopScrubbing());
    canvas.addEventListener('keydown', (event) => this.handleKeyDown(event));
  }

  private draw(): void {
    const canvas = this.canvasRef?.nativeElement;

    if (!canvas) {
      return;
    }

    const context = canvas.getContext('2d');

    if (!context) {
      return;
    }

    const width = canvas.clientWidth || 800;
    const height = 180;
    const devicePixelRatio = window.devicePixelRatio || 1;

    canvas.width = Math.floor(width * devicePixelRatio);
    canvas.height = Math.floor(height * devicePixelRatio);
    context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    context.clearRect(0, 0, width, height);

    const loadedWindow = this.loadedWindow();

    if (!loadedWindow) {
      this.drawEmptyState(context, width, height);
      return;
    }

    const totalRange = Math.max(loadedWindow.requestEndMs - loadedWindow.requestStartMs, 1);
    const laneX = 12;
    const laneY = 44;
    const laneWidth = width - 24;
    const laneHeight = 48;
    const markerY = 118;

    context.fillStyle = '#dbe7e7';
    context.fillRect(laneX, laneY, laneWidth, laneHeight);

    for (const gap of loadedWindow.gaps) {
      const startX = laneX + ((gap.startMs - loadedWindow.requestStartMs) / totalRange) * laneWidth;
      const gapWidth = ((gap.endMs - gap.startMs) / totalRange) * laneWidth;
      context.fillStyle = '#eef3f3';
      context.fillRect(startX, laneY, Math.max(gapWidth, 2), laneHeight);
      context.strokeStyle = 'rgba(23, 49, 59, 0.08)';
      context.strokeRect(startX, laneY, Math.max(gapWidth, 2), laneHeight);
    }

    for (const segment of loadedWindow.segments) {
      const startX = laneX + ((segment.startMs - loadedWindow.requestStartMs) / totalRange) * laneWidth;
      const segmentWidth = ((segment.endMs - segment.startMs) / totalRange) * laneWidth;
      context.fillStyle = '#d77742';
      context.fillRect(startX, laneY, Math.max(segmentWidth, 2), laneHeight);
    }

    for (const reviewEvent of loadedWindow.reviewEvents) {
      const x = laneX + ((reviewEvent.startMs - loadedWindow.requestStartMs) / totalRange) * laneWidth;
      const isSelected = reviewEvent.id === this.selectedReviewEventId();
      context.strokeStyle = isSelected ? '#194f6a' : '#4f8fb0';
      context.lineWidth = isSelected ? 4 : 2;
      context.beginPath();
      context.moveTo(x, markerY - 12);
      context.lineTo(x, markerY + 18);
      context.stroke();
      context.fillStyle = isSelected ? '#194f6a' : '#4f8fb0';
      context.beginPath();
      context.arc(x, markerY - 16, isSelected ? 5 : 4, 0, Math.PI * 2);
      context.fill();
    }

    const hoveredTimestamp = this.hoveredTimestamp();

    if (hoveredTimestamp) {
      const x = laneX + ((hoveredTimestamp - loadedWindow.requestStartMs) / totalRange) * laneWidth;
      context.strokeStyle = 'rgba(25, 79, 106, 0.45)';
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(x, 20);
      context.lineTo(x, 146);
      context.stroke();
    }

    context.fillStyle = '#17313b';
    context.font = '12px Space Grotesk, Segoe UI, sans-serif';
    context.fillText('00:00', laneX, 28);
    context.fillText('12:00', laneX + laneWidth / 2 - 16, 28);
    context.fillText('24:00', laneX + laneWidth - 34, 28);
  }

  private drawEmptyState(
    context: CanvasRenderingContext2D,
    width: number,
    height: number
  ): void {
    context.fillStyle = '#617980';
    context.font = '14px Space Grotesk, Segoe UI, sans-serif';
    context.fillText('Timeline visualization will appear when metadata is loaded.', 16, height / 2);
    context.strokeStyle = 'rgba(23, 49, 59, 0.12)';
    context.strokeRect(12, 32, width - 24, 100);
  }

  private handlePointerDown(event: PointerEvent): void {
    const canvas = this.canvasRef?.nativeElement;

    if (!canvas) {
      return;
    }

    canvas.focus();
    canvas.setPointerCapture(event.pointerId);
    this.isScrubbing = true;

    const timestampMs = this.resolveTimestamp(event.offsetX);
    this.hoverTimestampChange.emit(timestampMs);
    this.scrubTimestampChange.emit(timestampMs);
  }

  private handlePointerMove(event: PointerEvent): void {
    const timestampMs = this.resolveTimestamp(event.offsetX);

    this.hoverTimestampChange.emit(timestampMs);

    if (this.isScrubbing) {
      this.scrubTimestampChange.emit(timestampMs);
    }
  }

  private handlePointerUp(event: PointerEvent): void {
    const loadedWindow = this.loadedWindow();

    if (!loadedWindow) {
      return;
    }

    const timestampMs = this.resolveTimestamp(event.offsetX);
    this.hoverTimestampChange.emit(timestampMs);
    this.scrubTimestampChange.emit(timestampMs);
    const matchedReviewEvent = this.findNearestReviewEvent(loadedWindow.reviewEvents, timestampMs);

    if (matchedReviewEvent) {
      this.reviewEventSelect.emit(matchedReviewEvent.id);
      this.timelineSelect.emit(matchedReviewEvent.startMs);
      this.stopScrubbing(event.pointerId);
      return;
    }

    this.reviewEventSelect.emit(null);
    this.timelineSelect.emit(timestampMs);
    this.stopScrubbing(event.pointerId);
  }

  private handlePointerLeave(): void {
    if (this.isScrubbing) {
      return;
    }

    this.hoverTimestampChange.emit(null);
  }

  private handleKeyDown(event: KeyboardEvent): void {
    const loadedWindow = this.loadedWindow();

    if (!loadedWindow) {
      return;
    }

    const currentTimestamp =
      this.hoveredTimestamp() ?? this.selectedTimestampFallback(loadedWindow.requestStartMs, loadedWindow.requestEndMs);
    const shortStepMs = 5 * 60 * 1000;
    const longStepMs = 30 * 60 * 1000;
    const deltaMs = event.shiftKey ? longStepMs : shortStepMs;

    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      this.hoverTimestampChange.emit(Math.max(loadedWindow.requestStartMs, currentTimestamp - deltaMs));
      return;
    }

    if (event.key === 'ArrowRight') {
      event.preventDefault();
      this.hoverTimestampChange.emit(Math.min(loadedWindow.requestEndMs, currentTimestamp + deltaMs));
      return;
    }

    if (event.key === 'Home') {
      event.preventDefault();
      this.hoverTimestampChange.emit(loadedWindow.requestStartMs);
      return;
    }

    if (event.key === 'End') {
      event.preventDefault();
      this.hoverTimestampChange.emit(loadedWindow.requestEndMs);
      return;
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.scrubTimestampChange.emit(currentTimestamp);
      this.timelineSelect.emit(currentTimestamp);
    }
  }

  private stopScrubbing(pointerId?: number): void {
    const canvas = this.canvasRef?.nativeElement;

    if (canvas && pointerId !== undefined && canvas.hasPointerCapture(pointerId)) {
      canvas.releasePointerCapture(pointerId);
    }

    this.isScrubbing = false;
  }

  private resolveTimestamp(offsetX: number): number {
    const loadedWindow = this.loadedWindow();

    if (!loadedWindow) {
      return 0;
    }

    const canvas = this.canvasRef?.nativeElement;
    const width = canvas?.clientWidth || 800;
    const laneX = 12;
    const laneWidth = width - 24;
    const clampedX = Math.min(Math.max(offsetX, laneX), laneX + laneWidth);
    const ratio = (clampedX - laneX) / laneWidth;

    return Math.round(
      loadedWindow.requestStartMs + ratio * (loadedWindow.requestEndMs - loadedWindow.requestStartMs)
    );
  }

  private findNearestReviewEvent(
    reviewEvents: ReviewEvent[],
    timestampMs: number
  ): ReviewEvent | null {
    let bestMatch: ReviewEvent | null = null;
    let smallestDistance = 90_000;

    for (const reviewEvent of reviewEvents) {
      const distance = Math.abs(reviewEvent.startMs - timestampMs);

      if (distance < smallestDistance) {
        smallestDistance = distance;
        bestMatch = reviewEvent;
      }
    }

    return bestMatch;
  }

  protected tooltipLeft(): number {
    const loadedWindow = this.loadedWindow();
    const hoveredTimestamp = this.hoveredTimestamp();

    if (!loadedWindow || hoveredTimestamp === null) {
      return 50;
    }

    const ratio =
      (hoveredTimestamp - loadedWindow.requestStartMs) /
      Math.max(loadedWindow.requestEndMs - loadedWindow.requestStartMs, 1);

    return Math.min(Math.max(ratio * 100, 12), 88);
  }

  private selectedTimestampFallback(startMs: number, endMs: number): number {
    return Math.round(startMs + (endMs - startMs) / 2);
  }
}