import {
  AfterViewInit,
  Component,
  ElementRef,
  ViewChild,
  effect,
  input
} from '@angular/core';

import type { TimelineWindow } from '../../../data-access/frigate/adapter/frigate-adapter';

@Component({
  selector: 'app-timeline-canvas',
  standalone: true,
  template: `
    <div class="timeline-frame">
      <canvas #canvas class="timeline-canvas" aria-label="Timeline visualization"></canvas>
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
    }

    .timeline-canvas {
      display: block;
      width: 100%;
      height: 180px;
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

  @ViewChild('canvas') private canvasRef?: ElementRef<HTMLCanvasElement>;

  private isViewReady = false;

  constructor() {
    effect(() => {
      this.loadedWindow();
      this.selectedReviewEventId();

      if (this.isViewReady) {
        queueMicrotask(() => this.draw());
      }
    });
  }

  ngAfterViewInit(): void {
    this.isViewReady = true;
    this.draw();
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
}