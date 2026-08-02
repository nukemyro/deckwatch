import { TestBed } from '@angular/core/testing';

import { RUNTIME_CONFIG } from '../../core/config/runtime-config.token';
import type { RuntimeConfig } from '../../core/config/runtime-config';
import { ReolinkEventService } from './reolink-event.service';

describe('ReolinkEventService', () => {
  let service: ReolinkEventService;

  beforeEach(() => {
    const runtimeConfig: RuntimeConfig = {
      frigateBaseUrl: '',
      deploymentMode: 'direct',
      authMode: 'none',
      previewFramesEnabled: true,
      reviewOverlayEnabled: true,
      requestTimeoutMs: 15000,
      mqtt: {
        enabled: true,
        brokerUrl: 'YOUR_FRIGATE_HOST',
        brokerPort: 1883,
        useTls: false,
        clientId: 'deckwatch-test',
        topicPattern: 'reolink/+/events'
      }
    };

    TestBed.configureTestingModule({
      providers: [{ provide: RUNTIME_CONFIG, useValue: runtimeConfig }]
    });

    service = TestBed.inject(ReolinkEventService);
  });

  it('exposes a reactive connection state for the UI layer', () => {
    service.connectionState.set(true);

    expect(service.isConnected()).toBeTrue();
  });

  it('normalizes MQTT payloads into timeline events', () => {
    const payload = {
      deviceId: 'cam-front',
      eventType: 'detection',
      detectionType: 'person',
      confidence: 0.92,
      timestamp: 1_693_478_400_000,
      metadata: { zone: 'driveway' }
    };

    const event = service.normalizeMessage(payload, 'reolink/cam-front/events');

    expect(event).toEqual(
      jasmine.objectContaining({
        cameraId: 'cam-front',
        timestampMs: 1_693_478_400_000,
        type: 'detection',
        label: 'person',
        confidence: 0.92,
        source: 'reolink-mqtt'
      })
    );
  });
});
