import {
  APP_INITIALIZER,
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
  provideZoneChangeDetection
} from '@angular/core';
import { provideRouter } from '@angular/router';

import { routes } from './app.routes';
import { RuntimeConfigStore } from './core/config/runtime-config.store';
import { RUNTIME_CONFIG } from './core/config/runtime-config.token';
import { FRIGATE_ADAPTER } from './data-access/frigate/adapter/frigate-adapter.token';
import { NullFrigateAdapter } from './data-access/frigate/adapter/null-frigate-adapter.service';

function initializeRuntimeConfig(runtimeConfigStore: RuntimeConfigStore) {
  return () => runtimeConfigStore.load();
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    {
      provide: APP_INITIALIZER,
      multi: true,
      useFactory: initializeRuntimeConfig,
      deps: [RuntimeConfigStore]
    },
    {
      provide: RUNTIME_CONFIG,
      useFactory: (runtimeConfigStore: RuntimeConfigStore) => runtimeConfigStore.snapshot(),
      deps: [RuntimeConfigStore]
    },
    {
      provide: FRIGATE_ADAPTER,
      useClass: NullFrigateAdapter
    }
  ]
};
