import { KeyValuePipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { RUNTIME_CONFIG } from './core/config/runtime-config.token';
import { CameraWorkspaceStore } from './features/camera-workspace/state/camera-workspace.store';
import { ReviewStore } from './features/review-overlay/state/review.store';
import { TimelineCanvasComponent } from './features/timeline/components/timeline-canvas.component';
import { TimelineStore } from './features/timeline/state/timeline.store';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, TimelineCanvasComponent, KeyValuePipe],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  protected readonly title = signal('Camera Scroll');
  protected readonly runtimeConfig = inject(RUNTIME_CONFIG);
  protected readonly cameraWorkspaceStore = inject(CameraWorkspaceStore);
  protected readonly reviewStore = inject(ReviewStore);
  protected readonly timelineStore = inject(TimelineStore);

  protected selectReviewEvent(eventId: string | null): void {
    this.reviewStore.selectEvent(eventId);
  }

  constructor() {
    void this.cameraWorkspaceStore.loadCameras();
  }

  protected selectCamera(cameraId: string): void {
    this.cameraWorkspaceStore.selectCamera(cameraId);
  }
}
