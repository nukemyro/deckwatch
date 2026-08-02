import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';

import { FRIGATE_ADAPTER } from '../../../data-access/frigate/adapter/frigate-adapter.token';
import { ReolinkEventService, type ReolinkTimelineEvent } from '../../../data-access/reolink/reolink-event.service';
import { CameraWorkspaceStore } from '../../camera-workspace/state/camera-workspace.store';
import { ReviewStore } from '../../review-overlay/state/review.store';
import { TimelineStore } from './timeline.store';

describe('TimelineStore', () => {
  it('reloads the visible window when a new MQTT marker arrives within the current range', async () => {
    const cameraWorkspace = signal({
      selectedCameraId: 'cam-1',
      visibleRangeStartMs: 0,
      visibleRangeEndMs: 1000
    });

    const recordingsSpy = jasmine.createSpy().and.resolveTo([]);
    const reviewEventsSpy = jasmine.createSpy().and.resolveTo([]);
    const liveMqttEvents: ReolinkTimelineEvent[] = [];
    const getEventsSpy = jasmine.createSpy().and.callFake((input: { cameraId?: string; startMs: number; endMs: number }) => {
      const matchingEvents = liveMqttEvents.filter((event) => {
        if (event.cameraId !== input.cameraId) {
          return false;
        }

        return event.timestampMs >= input.startMs && event.timestampMs <= input.endMs;
      });

      return Promise.resolve(matchingEvents);
    });
    const mqttEvents$ = new Subject<ReolinkTimelineEvent>();

    const mockFrigateAdapter = {
      getRecordings: recordingsSpy,
      getPreviewFrame: jasmine.createSpy().and.resolveTo(null),
      resolvePlaybackSource: jasmine.createSpy().and.resolveTo(null)
    };

    const mockReviewStore = {
      loadReviewEvents: reviewEventsSpy
    };

    const mockReolinkEventService = {
      events$: mqttEvents$.asObservable(),
      getEvents: getEventsSpy
    };

    TestBed.configureTestingModule({
      providers: [
        TimelineStore,
        { provide: FRIGATE_ADAPTER, useValue: mockFrigateAdapter },
        { provide: CameraWorkspaceStore, useValue: { cameraWorkspace } },
        { provide: ReviewStore, useValue: mockReviewStore },
        { provide: ReolinkEventService, useValue: mockReolinkEventService }
      ]
    });

    const store = TestBed.inject(TimelineStore);
    TestBed.flushEffects();
    await Promise.resolve();

    liveMqttEvents.push({
      id: 'event-1',
      cameraId: 'cam-1',
      timestampMs: 500,
      type: 'detection',
      label: 'person',
      source: 'reolink-mqtt'
    });

    mqttEvents$.next(liveMqttEvents[0]);

    await new Promise((resolve) => setTimeout(resolve));

    expect(recordingsSpy).toHaveBeenCalledTimes(2);
    expect(getEventsSpy).toHaveBeenCalledTimes(2);
    expect(store.timelineState().loadedWindow?.timelineMarkerEvents.length).toBe(1);
  });
});
