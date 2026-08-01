import { InjectionToken } from '@angular/core';

import type { FrigateAdapter } from './frigate-adapter';

export const FRIGATE_ADAPTER = new InjectionToken<FrigateAdapter>('FRIGATE_ADAPTER');