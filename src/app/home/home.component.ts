import { KeyValuePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';

import { RUNTIME_CONFIG } from '../core/config/runtime-config.token';
import { CameraWorkspaceStore } from '../features/camera-workspace/state/camera-workspace.store';
import { PlaybackStore } from '../features/playback/state/playback.store';
import { ReviewStore } from '../features/review-overlay/state/review.store';
import { TimelineStore } from '../features/timeline/state/timeline.store';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [KeyValuePipe],
  templateUrl: './home.component.html',
  styleUrl: './home.component.scss'
})
export class HomeComponent {
  protected readonly title = signal('DeckWatch');
  protected readonly runtimeConfig = inject(RUNTIME_CONFIG);
  protected readonly cameraWorkspaceStore = inject(CameraWorkspaceStore);
  private readonly router = inject(Router);
  protected readonly playbackStore = inject(PlaybackStore);
  protected readonly reviewStore = inject(ReviewStore);
  protected readonly timelineStore = inject(TimelineStore);
  protected readonly authStatus = signal<'unknown' | 'ready' | 'error'>('unknown');
  protected readonly authMessage = signal('');
  protected readonly hasAuthenticatedSession = signal(false);
  protected readonly showLoginPanel = computed(
    () => this.runtimeConfig.authMode === 'cookie' && !this.hasAuthenticatedSession()
  );

  constructor() {
    void this.bootstrapConnection();
  }

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
        this.hasAuthenticatedSession.set(false);
        this.authStatus.set('error');
        this.authMessage.set('Frigate login failed. Check the credentials and try again.');
        return;
      }

      this.hasAuthenticatedSession.set(true);
      this.authStatus.set('ready');
      this.authMessage.set('Authenticated with Frigate. Reloading camera catalog...');
      await this.cameraWorkspaceStore.loadCameras();

      if (this.cameraWorkspaceStore.selectedCamera()) {
        void this.router.navigateByUrl('/timeline');
      }
    } catch {
      this.hasAuthenticatedSession.set(false);
      this.authStatus.set('error');
      this.authMessage.set('Unable to reach Frigate through the local proxy.');
    }
  }

  protected selectCamera(cameraId: string): void {
    this.cameraWorkspaceStore.selectCamera(cameraId);
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

  private async bootstrapConnection(): Promise<void> {
    await this.cameraWorkspaceStore.loadCameras();

    if (!this.cameraWorkspaceStore.error()) {
      this.hasAuthenticatedSession.set(true);
      this.authStatus.set('ready');

      if (this.cameraWorkspaceStore.selectedCamera()) {
        void this.router.navigateByUrl('/timeline');
      }
    }
  }
}
