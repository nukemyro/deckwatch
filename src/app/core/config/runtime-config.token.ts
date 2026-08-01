import { InjectionToken } from '@angular/core';

import type { RuntimeConfig } from './runtime-config';

export const RUNTIME_CONFIG = new InjectionToken<RuntimeConfig>('RUNTIME_CONFIG');