import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { FRIGATE_ADAPTER } from './data-access/frigate/adapter/frigate-adapter.token';
import type { FrigateAdapter } from './data-access/frigate/adapter/frigate-adapter';
import { RUNTIME_CONFIG } from './core/config/runtime-config.token';
import type { RuntimeConfig } from './core/config/runtime-config';
import { App } from './app';

describe('App', () => {
  beforeEach(async () => {
    const runtimeConfig: RuntimeConfig = {
      frigateBaseUrl: '',
      deploymentMode: 'direct',
      authMode: 'none',
      previewFramesEnabled: true,
      reviewOverlayEnabled: true,
      requestTimeoutMs: 15000
    };

    const frigateAdapterStub: FrigateAdapter = {
      getCameras: async () => [],
      getRecordings: async () => [],
      getReviewEvents: async () => [],
      getPreviewFrame: async () => null,
      resolvePlaybackSource: async () => null
    };

    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideRouter([]),
        { provide: RUNTIME_CONFIG, useValue: runtimeConfig },
        { provide: FRIGATE_ADAPTER, useValue: frigateAdapterStub }
      ]
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should render router outlet', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('router-outlet')).toBeTruthy();
  });
});
