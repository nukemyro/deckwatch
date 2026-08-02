import { TestBed } from '@angular/core/testing';

import { App } from './app';
import { RUNTIME_CONFIG } from './core/config/runtime-config.token';
import { defaultRuntimeConfig } from './core/config/runtime-config';
import { FRIGATE_ADAPTER } from './data-access/frigate/adapter/frigate-adapter.token';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        {
          provide: RUNTIME_CONFIG,
          useValue: defaultRuntimeConfig
        },
        {
          provide: FRIGATE_ADAPTER,
          useValue: {
            getCameras: jasmine.createSpy().and.resolveTo([]),
            getRecordings: jasmine.createSpy().and.resolveTo([]),
            getPreviewFrame: jasmine.createSpy().and.resolveTo(null),
            resolvePlaybackSource: jasmine.createSpy().and.resolveTo(null)
          }
        }
      ]
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should render title', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('h1')?.textContent).toContain('DeckWatch');
  });
});
