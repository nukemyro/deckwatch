import { Injectable } from '@angular/core';

import { defaultRuntimeConfig, type RuntimeConfig } from './runtime-config';

@Injectable({ providedIn: 'root' })
export class RuntimeConfigStore {
  private config: RuntimeConfig = defaultRuntimeConfig;

  async load(): Promise<void> {
    try {
      const response = await fetch('/runtime-config.json', {
        cache: 'no-store'
      });

      if (!response.ok) {
        this.config = defaultRuntimeConfig;
        return;
      }

      const loadedConfig = (await response.json()) as Partial<RuntimeConfig>;
      this.config = {
        ...defaultRuntimeConfig,
        ...loadedConfig
      };
    } catch {
      this.config = defaultRuntimeConfig;
    }
  }

  snapshot(): RuntimeConfig {
    return this.config;
  }
}