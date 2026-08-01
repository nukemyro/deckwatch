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

type FrigateCameraDto = {
  friendly_name?: string;
  name?: string;
  enabled?: boolean;
  record?: { enabled?: boolean };
  detect?: { enabled?: boolean };
  review?: { alerts?: { enabled?: boolean }; detections?: { enabled?: boolean } };
  ui?: { order?: number; dashboard?: boolean };
};

type FrigateConfigDto = {
  cameras?: Record<string, FrigateCameraDto>;
};

type FrigateRecordingDto = {
  camera?: string;
  start_time?: number | string;
  end_time?: number | string;
  duration?: number;
  path?: string;
};

type FrigateReviewEventDto = {
  id?: string | number;
  camera?: string;
  start_time?: number | string;
  end_time?: number | string;
  severity?: string;
  label?: string;
  data?: { objects?: string[]; sub_label?: string };
};

@Injectable()
export class HttpFrigateAdapter implements FrigateAdapter {
  private readonly runtimeConfig = inject(RUNTIME_CONFIG);

  async getCameras(): Promise<CameraSummary[]> {
    if (!this.hasApiBaseUrl()) {
      return [];
    }

    const response = await this.fetchJson<
      FrigateConfigDto | Record<string, FrigateCameraDto> | CameraSummary[]
    >(
      this.buildUrl(this.resolvePath('cameras'))
    );

    if (Array.isArray(response)) {
      return response;
    }

    const cameraMap = 'cameras' in response && response.cameras ? response.cameras : response;

    return Object.entries(cameraMap)
      .map(([cameraId, camera]) => this.mapCamera(cameraId, camera))
      .sort((left, right) => {
        const orderDelta = (left.order ?? 0) - (right.order ?? 0);
        return orderDelta !== 0 ? orderDelta : left.name.localeCompare(right.name);
      })
      .map(({ order: _order, ...camera }) => camera);
  }

  async getRecordings(input: GetRecordingsInput): Promise<RecordingSegment[]> {
    if (!this.hasApiBaseUrl()) {
      return [];
    }

    const params = new URLSearchParams({
      after: this.toEpochSeconds(input.startMs),
      before: this.toEpochSeconds(input.endMs)
    });

    const response = await this.fetchJson<FrigateRecordingDto[]>(
      this.buildUrl(this.resolvePath('recordings', input.cameraId), params)
    );

    return response.map((recording) => this.mapRecording(input.cameraId, recording));
  }

  async getReviewEvents(input: GetReviewEventsInput): Promise<ReviewEvent[]> {
    if (!this.hasApiBaseUrl()) {
      return [];
    }

    const params = new URLSearchParams({
      cameras: input.cameraId,
      after: this.toEpochSeconds(input.startMs),
      before: this.toEpochSeconds(input.endMs)
    });

    if (input.types?.length) {
      params.set('types', input.types.join(','));
    }

    if (input.labels?.length) {
      params.set('labels', input.labels.join(','));
    }

    const response = await this.fetchJson<FrigateReviewEventDto[]>(
      this.buildUrl(this.resolvePath('review-events'), params)
    );

    return response.map((reviewEvent) => this.mapReviewEvent(input.cameraId, reviewEvent));
  }

  async getPreviewFrame(_input: GetPreviewFrameInput): Promise<PreviewFrame | null> {
    if (!this.hasApiBaseUrl()) {
      return null;
    }

    const frameTimeSeconds = this.toEpochSeconds(_input.timestampMs);
    const params = new URLSearchParams();

    if (_input.height) {
      params.set('height', String(_input.height));
    }

    return {
      cameraId: _input.cameraId,
      timestampMs: _input.timestampMs,
      imageUrl: this.buildUrl(
        `/api/${_input.cameraId}/recordings/${frameTimeSeconds}/snapshot.jpg`,
        params
      ),
      width: _input.width,
      height: _input.height
    };
  }

  async resolvePlaybackSource(
    input: ResolvePlaybackSourceInput
  ): Promise<PlaybackSource | null> {
    if (!this.hasApiBaseUrl()) {
      return null;
    }

    if (this.runtimeConfig.deploymentMode === 'proxy') {
      try {
        const params = new URLSearchParams({
          camera: input.cameraId,
          timestamp: this.toEpochSeconds(input.timestampMs)
        });

        const response = await this.fetchJson<{
          url?: string;
          startMs?: number | string;
          endMs?: number | string;
          transport?: PlaybackSource['transport'];
        }>(this.buildUrl('/api/playback-source', params));

        if (response.url) {
          return {
            cameraId: input.cameraId,
            requestedTimestampMs: input.timestampMs,
            resolvedUrl: this.resolveMediaUrl(response.url),
            playableRangeStartMs: this.toEpochMilliseconds(response.startMs) || input.timestampMs,
            playableRangeEndMs: this.toEpochMilliseconds(response.endMs) || input.timestampMs,
            transport: response.transport || 'unknown'
          };
        }
      } catch {
        // Fall back to recording-based resolution below.
      }
    }

    const startMs = input.timestampMs - 3_600_000;
    const endMs = input.timestampMs + 3_600_000;
    const recordings = await this.getRecordings({
      cameraId: input.cameraId,
      startMs,
      endMs
    });

    const containingSegment = recordings.find(
      (recording) => recording.startMs <= input.timestampMs && recording.endMs >= input.timestampMs
    );

    const nearestSegment =
      containingSegment ||
      recordings
        .slice()
        .sort(
          (left, right) =>
            Math.abs(left.startMs - input.timestampMs) - Math.abs(right.startMs - input.timestampMs)
        )[0];

    if (!nearestSegment || !nearestSegment.mediaPath) {
      return null;
    }

    return {
      cameraId: input.cameraId,
      requestedTimestampMs: input.timestampMs,
      resolvedUrl: this.resolveMediaUrl(nearestSegment.mediaPath),
      playableRangeStartMs: nearestSegment.startMs,
      playableRangeEndMs: nearestSegment.endMs,
      transport: 'mp4'
    };
  }

  private async fetchJson<T>(url: string): Promise<T> {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Frigate request failed with status ${response.status}.`);
    }

    return (await response.json()) as T;
  }

  private resolvePath(
    resource: 'cameras' | 'recordings' | 'review-events',
    cameraId?: string
  ): string {
    if (this.runtimeConfig.deploymentMode === 'proxy') {
      if (resource === 'cameras') {
        return '/api/config';
      }

      if (resource === 'recordings') {
        return `/api/${cameraId}/recordings`;
      }

      return '/api/review';
    }

    if (resource === 'cameras') {
      return '/api/config';
    }

    if (resource === 'recordings') {
      return `/api/${cameraId}/recordings`;
    }

    return '/api/review';
  }

  private buildUrl(path: string, params?: URLSearchParams): string {
    const url = `${this.baseUrl}${path}`;
    return params ? `${url}?${params.toString()}` : url;
  }

  private resolveMediaUrl(path: string): string {
    if (/^https?:\/\//.test(path)) {
      return path;
    }

    if (this.runtimeConfig.deploymentMode === 'proxy' && !this.runtimeConfig.proxyBaseUrl) {
      return path.startsWith('/') ? path : `/${path}`;
    }

    if (path.startsWith('/')) {
      return `${this.baseUrl}${path}`;
    }

    return `${this.baseUrl}/${path}`;
  }

  private mapCamera(cameraId: string, camera: FrigateCameraDto): CameraSummary & { order?: number } {
    return {
      id: cameraId,
      name: camera.friendly_name || camera.name || cameraId,
      enabled: camera.enabled !== false,
      hasRecordings: camera.record?.enabled !== false,
      hasReviewEvents:
        camera.review?.alerts?.enabled !== false || camera.review?.detections?.enabled !== false,
      order: camera.ui?.order,
      timezone: undefined
    };
  }

  private mapRecording(cameraId: string, recording: FrigateRecordingDto): RecordingSegment {
    const startMs = this.toEpochMilliseconds(recording.start_time);
    const endMs = this.toEpochMilliseconds(recording.end_time);
    const durationMs = recording.duration ? recording.duration * 1000 : Math.max(endMs - startMs, 0);

    return {
      cameraId: recording.camera || cameraId,
      startMs,
      endMs,
      durationMs,
      mediaPath: recording.path || '',
      sourceKind: 'recording'
    };
  }

  private mapReviewEvent(cameraId: string, reviewEvent: FrigateReviewEventDto): ReviewEvent {
    const startMs = this.toEpochMilliseconds(reviewEvent.start_time);
    const endMs = reviewEvent.end_time ? this.toEpochMilliseconds(reviewEvent.end_time) : startMs;

    return {
      id: String(reviewEvent.id || `${cameraId}-${startMs}`),
      cameraId: reviewEvent.camera || cameraId,
      startMs,
      endMs,
      type: reviewEvent.data?.objects?.[0] || reviewEvent.label || 'review',
      severity: reviewEvent.severity,
      label: reviewEvent.data?.sub_label || reviewEvent.label
    };
  }

  private toEpochMilliseconds(value: number | string | undefined): number {
    if (typeof value === 'number') {
      return value > 10_000_000_000 ? value : value * 1000;
    }

    if (typeof value === 'string' && value.length > 0) {
      const numericValue = Number(value);

      if (!Number.isNaN(numericValue)) {
        return numericValue > 10_000_000_000 ? numericValue : numericValue * 1000;
      }

      return Date.parse(value);
    }

    return 0;
  }

  private toEpochSeconds(value: number): string {
    return String(Math.floor(value / 1000));
  }

  private hasApiBaseUrl(): boolean {
    if (this.runtimeConfig.deploymentMode === 'proxy') {
      return true;
    }

    return this.baseUrl.length > 0;
  }

  private get baseUrl(): string {
    if (this.runtimeConfig.deploymentMode === 'proxy') {
      return (this.runtimeConfig.proxyBaseUrl || '').replace(/\/$/, '');
    }

    return this.runtimeConfig.frigateBaseUrl.replace(/\/$/, '');
  }
}
