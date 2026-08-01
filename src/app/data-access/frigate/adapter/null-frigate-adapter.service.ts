import { Injectable, inject } from '@angular/core';

import { RUNTIME_CONFIG } from '../../../core/config/runtime-config.token';
import type {
  CameraSummary,
  FrigateAdapter,
  GetPreviewFrameInput,
  GetRecordingsInput,
  GetReviewEventsInput,
  PlaybackSource,
  PreviewFrame,
  RecordingSegment,
  ResolvePlaybackSourceInput,
  ReviewEvent
} from './frigate-adapter';

@Injectable()
export class NullFrigateAdapter implements FrigateAdapter {
  private readonly runtimeConfig = inject(RUNTIME_CONFIG);

  async getCameras(): Promise<CameraSummary[]> {
    return [];
  }

  async getRecordings(_input: GetRecordingsInput): Promise<RecordingSegment[]> {
    return [];
  }

  async getReviewEvents(_input: GetReviewEventsInput): Promise<ReviewEvent[]> {
    return [];
  }

  async getPreviewFrame(_input: GetPreviewFrameInput): Promise<PreviewFrame | null> {
    return null;
  }

  async resolvePlaybackSource(
    _input: ResolvePlaybackSourceInput
  ): Promise<PlaybackSource | null> {
    return null;
  }

  get baseUrl(): string {
    return this.runtimeConfig.proxyBaseUrl || this.runtimeConfig.frigateBaseUrl;
  }
}