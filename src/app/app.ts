import { KeyValuePipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { RUNTIME_CONFIG } from './core/config/runtime-config.token';
import { CameraWorkspaceStore } from './features/camera-workspace/state/camera-workspace.store';
import { PlaybackStore } from './features/playback/state/playback.store';
import { ReviewStore } from './features/review-overlay/state/review.store';
import { TimelineViewComponent } from './features/timeline/components/timeline-view.component';
import { TimelineStore } from './features/timeline/state/timeline.store';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, TimelineViewComponent, KeyValuePipe],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  protected readonly title = signal('Camera Scroll');
  protected readonly runtimeConfig = inject(RUNTIME_CONFIG);
  protected readonly cameraWorkspaceStore = inject(CameraWorkspaceStore);
  protected readonly playbackStore = inject(PlaybackStore);
  protected readonly reviewStore = inject(ReviewStore);
  protected readonly timelineStore = inject(TimelineStore);
  protected readonly authStatus = signal<'unknown' | 'ready' | 'error'>('unknown');
  protected readonly authMessage = signal('');

  protected selectReviewEvent(eventId: string | null): void {
    this.reviewStore.selectEvent(eventId);

    if (!eventId) {
      return;
    }

    const selectedEvent = this.reviewStore
      .reviewState()
      .events.find((reviewEvent) => reviewEvent.id === eventId);

    if (selectedEvent) {
      this.playbackStore.setTargetTimestamp(selectedEvent.startMs);
      this.timelineStore.setScrubTimestamp(selectedEvent.startMs);
    }
  }

  constructor() {
    void this.cameraWorkspaceStore.loadCameras();
  }

  protected async loginToFrigate(user: string, password: string): Promise<void> {
    this.authStatus.set('unknown');
    this.authMessage.set('');

    try {
      const response = await fetch('/api/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-TOKEN': '1'
        },
        credentials: 'include',
        body: JSON.stringify({
          user,
          password
        })
      });

      if (!response.ok) {
        this.authStatus.set('error');
        this.authMessage.set('Frigate login failed. Check the credentials and try again.');
        return;
      }

      this.authStatus.set('ready');
      this.authMessage.set('Authenticated with Frigate. Reloading camera catalog...');
      await this.cameraWorkspaceStore.loadCameras();
    } catch {
      this.authStatus.set('error');
      this.authMessage.set('Unable to reach Frigate through the local proxy.');
    }
  }

  protected selectCamera(cameraId: string): void {
    this.cameraWorkspaceStore.selectCamera(cameraId);
  }

  protected handleTimelineHover(timestampMs: number | null): void {
    this.timelineStore.setHoveredTimestamp(timestampMs);
  }

  protected handleTimelineSelect(timestampMs: number): void {
    this.timelineStore.setScrubTimestamp(timestampMs);
    this.playbackStore.setTargetTimestamp(timestampMs);
  }

  protected handleTimelineScrub(timestampMs: number | null): void {
    this.timelineStore.setScrubTimestamp(timestampMs);
  }

  protected handleTimelineReviewEventSelect(eventId: string | null): void {
    this.reviewStore.selectEvent(eventId);
  }

  protected handleVideoLoadStart(): void {
    this.playbackStore.setPlayerStatus('loading');
  }

  protected handleVideoCanPlay(): void {
    this.playbackStore.setPlayerStatus('ready');
  }

  protected handleVideoPlay(): void {
    this.playbackStore.setPlayerStatus('playing');
  }

  protected handleVideoPause(): void {
    if (this.playbackStore.playbackState().resolvedSource) {
      this.playbackStore.setPlayerStatus('ready');
    }
  }

  protected handleSelectedDateChange(event: Event): void {
    const nextValue = (event.target as HTMLInputElement | null)?.value;

    if (nextValue) {
      this.cameraWorkspaceStore.setSelectedDate(nextValue);
    }
  }

  protected shiftTimelineWindow(direction: 'backward' | 'forward'): void {
    this.cameraWorkspaceStore.shiftVisibleRange(direction);
  }

  protected zoomTimeline(direction: 'in' | 'out'): void {
    this.cameraWorkspaceStore.zoomVisibleRange(direction);
  }
}
