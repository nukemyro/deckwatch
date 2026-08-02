import { Injectable, inject, signal } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import mqtt, { type MqttClient } from 'mqtt';

import { RUNTIME_CONFIG } from '../../core/config/runtime-config.token';
import type { RuntimeConfig } from '../../core/config/runtime-config';

export type ReolinkEventType = 'detection' | 'alarm' | 'motion' | 'unknown';

export type ReolinkTimelineEvent = {
  id: string;
  cameraId: string;
  timestampMs: number;
  durationMs?: number;
  type: ReolinkEventType;
  label?: string;
  confidence?: number;
  source: 'reolink-mqtt';
  metadata?: Record<string, unknown>;
};

export type ReolinkEventQuery = {
  cameraId?: string;
  startMs: number;
  endMs: number;
  types?: ReolinkEventType[];
  labels?: string[];
};

export type MqttConfig = NonNullable<RuntimeConfig['mqtt']>;

@Injectable({ providedIn: 'root' })
export class ReolinkEventService {
  private readonly runtimeConfig = inject(RUNTIME_CONFIG);
  private readonly incomingEvents = new Subject<ReolinkTimelineEvent>();
  private readonly cache = new Map<string, ReolinkTimelineEvent[]>();
  private readonly config = this.runtimeConfig.mqtt;
  private readonly connectionState = signal(false);
  private client: MqttClient | null = null;
  private readonly debugWindow = typeof window !== 'undefined'
    ? (window as Window & { __deckwatchMqttDebug?: Record<string, unknown> })
    : null;
  private readonly liveEvents: ReolinkTimelineEvent[] = [];
  private connectionStateChangedAt = 0;

  constructor() {
    void this.initialize();
  }

  get events$(): Observable<ReolinkTimelineEvent> {
    return this.incomingEvents.asObservable();
  }

  async initialize(): Promise<void> {
    if (!this.config?.enabled) {
      return;
    }

    if (this.client) {
      return;
    }

    try {
      const brokerUrl = this.buildBrokerUrl();
      this.updateDebugState({ status: 'connecting', brokerUrl, options: this.buildClientOptions() });
      console.log('[Reolink MQTT] attempting connection', brokerUrl, this.buildClientOptions());
      this.client = mqtt.connect(brokerUrl, this.buildClientOptions());

      this.client.on('connect', () => {
        console.log('[Reolink MQTT] connected', brokerUrl);
        this.updateDebugState({ status: 'connected', brokerUrl });
        this.connectionState.set(true);
        this.connectionStateChangedAt = Date.now();
        this.subscribeToTopics();
      });

      this.client.on('reconnect', () => {
        console.log('[Reolink MQTT] reconnecting');
        this.updateDebugState({ status: 'reconnecting', brokerUrl });
        this.connectionState.set(false);
      });

      this.client.on('offline', () => {
        console.log('[Reolink MQTT] offline');
        this.updateDebugState({ status: 'offline', brokerUrl });
        this.connectionState.set(false);
      });

      this.client.on('message', (topic: string, message: Buffer | string) => {
        console.log('[Reolink MQTT] message received', topic, message.toString());
        const normalized = this.normalizeMessage(this.parseMessagePayload(message), topic);

        if (normalized) {
          console.log('[Reolink MQTT] normalized event', normalized);
          this.connectionStateChangedAt = Date.now();
          this.recordLiveEvent(normalized);
        }
      });

      this.client.on('error', (error: Error) => {
        this.updateDebugState({ status: 'error', error: error.message });
        this.connectionState.set(false);
        this.connectionStateChangedAt = Date.now();
        console.error('[Reolink MQTT] error', error);
      });

      this.client.on('end', () => {
        console.log('[Reolink MQTT] ended');
        this.updateDebugState({ status: 'ended' });
        this.connectionState.set(false);
        this.connectionStateChangedAt = Date.now();
      });

      this.client.on('close', () => {
        console.log('[Reolink MQTT] closed');
        this.updateDebugState({ status: 'closed' });
        this.connectionState.set(false);
        this.connectionStateChangedAt = Date.now();

        if (!this.client) {
          return;
        }

        const nextAttempt = this.client.reconnect ? this.client.reconnect() : undefined;
        if (nextAttempt) {
          console.log('[Reolink MQTT] reconnect scheduled');
        }
      });
    } catch (error) {
      this.connectionState.set(false);
      console.error('[Reolink MQTT]', error);
    }
  }

  isConnected(): boolean {
    return this.connectionState();
  }

  private updateDebugState(partial: Record<string, unknown>): void {
    if (!this.debugWindow) {
      return;
    }

    this.debugWindow.__deckwatchMqttDebug = {
      ...(this.debugWindow.__deckwatchMqttDebug ?? {}),
      ...partial
    };
  }

  getLastActivityAt(): number {
    return this.connectionStateChangedAt;
  }

  async getEvents(input: ReolinkEventQuery): Promise<ReolinkTimelineEvent[]> {
    const cacheKey = this.buildCacheKey(input);
    const cached = this.cache.get(cacheKey);

    if (cached) {
      return cached;
    }

    const filteredEvents = this.liveEvents.filter((event) => this.matchesQuery(event, input));
    this.cache.set(cacheKey, filteredEvents);
    return filteredEvents;
  }

  normalizeMessage(payload: unknown, topic: string): ReolinkTimelineEvent | null {
    const candidate = this.parsePayloadObject(payload);

    if (!candidate) {
      return null;
    }

    const deviceId = this.extractDeviceId(candidate, topic);
    const timestamp = this.toEpochMilliseconds(candidate['timestamp']);

    if (!deviceId || !Number.isFinite(timestamp)) {
      return null;
    }

    const eventType = this.mapEventType(
      candidate['eventType'] ?? candidate['type'] ?? candidate['kind']
    );
    const label = this.resolveLabel(candidate);
    const confidence = this.toConfidence(candidate['confidence']);
    const durationMs = this.toDurationMs(candidate['duration']);

    return {
      id: `${deviceId}:${timestamp}:${label ?? eventType}`,
      cameraId: deviceId,
      timestampMs: timestamp,
      durationMs,
      type: eventType,
      label,
      confidence,
      source: 'reolink-mqtt',
      metadata: this.toMetadata(candidate)
    };
  }

  private buildCacheKey(input: ReolinkEventQuery): string {
    return [
      input.cameraId ?? 'all',
      input.startMs,
      input.endMs,
      input.types?.join(',') ?? '',
      input.labels?.join(',') ?? ''
    ].join(':');
  }

  private buildBrokerUrl(): string {
    const brokerUrl = this.resolveBrokerHost(this.config?.brokerUrl?.trim());

    if (!brokerUrl) {
      return 'ws://localhost:9001';
    }

    if (
      brokerUrl.startsWith('ws://') ||
      brokerUrl.startsWith('wss://') ||
      brokerUrl.startsWith('mqtt://') ||
      brokerUrl.startsWith('mqtts://')
    ) {
      return brokerUrl;
    }

    const protocol = this.config?.useTls ? 'wss' : 'ws';
    const port = this.config?.brokerPort || 9001;

    if (port === 8000 && brokerUrl === 'broker.hivemq.com') {
      return `${protocol}://${brokerUrl}:${port}/mqtt`;
    }

    return `${protocol}://${brokerUrl}:${port}`;
  }

  private resolveBrokerHost(candidate: string | undefined): string | undefined {
    if (!candidate) {
      if (typeof window !== 'undefined' && window.location?.hostname) {
        return window.location.hostname;
      }

      return undefined;
    }

    if (
      candidate.startsWith('ws://') ||
      candidate.startsWith('wss://') ||
      candidate.startsWith('mqtt://') ||
      candidate.startsWith('mqtts://')
    ) {
      return candidate;
    }

    if (candidate === 'localhost' || candidate === '127.0.0.1' || candidate === '0.0.0.0') {
      if (typeof window !== 'undefined' && window.location?.hostname) {
        const browserHost = window.location.hostname;

        if (browserHost && browserHost !== 'localhost' && browserHost !== '127.0.0.1') {
          return browserHost;
        }
      }

      return candidate;
    }

    return candidate;
  }

  private buildClientOptions(): Record<string, unknown> {
    const clientId = this.config?.clientId ?? `deckwatch-browser-${Date.now()}-${Math.random().toString(16).slice(2)}`;

    return {
      clientId,
      clean: true,
      reconnectPeriod: 15_000,
      connectTimeout: 20_000,
      keepalive: 60,
      protocolVersion: 4,
      resubscribe: true,
      username: this.config?.username,
      password: this.config?.password
    };
  }

  private subscribeToTopics(): void {
    if (!this.client || !this.config?.topicPattern) {
      return;
    }

    const topicPattern = this.config?.topicPattern;

    if (!topicPattern) {
      return;
    }

    this.client.subscribe(topicPattern, { qos: 0 }, (error?: Error | null) => {
      if (error) {
        console.error('[Reolink MQTT] subscribe failed', error);
        return;
      }

      console.log('[Reolink MQTT] subscribed to', topicPattern);
    });
  }

  private recordLiveEvent(event: ReolinkTimelineEvent): void {
    this.liveEvents.push(event);
    this.cache.clear();
    this.incomingEvents.next(event);
  }

  private parseMessagePayload(message: Buffer | string): unknown {
    if (typeof message === 'string') {
      return message;
    }

    return message.toString();
  }

  private parsePayloadObject(payload: unknown): Record<string, unknown> | null {
    if (!payload) {
      return null;
    }

    if (typeof payload === 'object') {
      return payload as Record<string, unknown>;
    }

    if (typeof payload === 'string') {
      try {
        const parsed = JSON.parse(payload);
        return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null;
      } catch {
        return null;
      }
    }

    return null;
  }

  private matchesQuery(event: ReolinkTimelineEvent, input: ReolinkEventQuery): boolean {
    if (event.timestampMs < input.startMs || event.timestampMs > input.endMs) {
      return false;
    }

    if (input.cameraId && event.cameraId !== input.cameraId) {
      return false;
    }

    if (input.types?.length && !input.types.includes(event.type)) {
      return false;
    }

    if (input.labels?.length && event.label && !input.labels.includes(event.label)) {
      return false;
    }

    return true;
  }

  private extractDeviceId(candidate: Record<string, unknown>, topic: string): string | null {
    const explicitDeviceId = this.toString(
      candidate['deviceId'] ?? candidate['cameraId'] ?? candidate['id']
    );
    if (explicitDeviceId) {
      return explicitDeviceId;
    }

    const topicParts = topic.split('/').filter(Boolean);
    const cameraPart = topicParts[1] ?? topicParts[0] ?? '';
    return cameraPart || null;
  }

  private mapEventType(value: unknown): ReolinkEventType {
    if (typeof value === 'string') {
      const normalized = value.toLowerCase();
      if (normalized.includes('alarm')) {
        return 'alarm';
      }
      if (normalized.includes('motion')) {
        return 'motion';
      }
      if (normalized.includes('detect')) {
        return 'detection';
      }
    }

    return 'unknown';
  }

  private resolveLabel(candidate: Record<string, unknown>): string | undefined {
    return this.toString(
      candidate['label'] ?? candidate['detectionType'] ?? candidate['eventType'] ?? candidate['kind']
    );
  }

  private toConfidence(value: unknown): number | undefined {
    if (typeof value === 'number') {
      return value;
    }

    if (typeof value === 'string') {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : undefined;
    }

    return undefined;
  }

  private toDurationMs(value: unknown): number | undefined {
    if (typeof value === 'number') {
      return value;
    }

    if (typeof value === 'string') {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : undefined;
    }

    return undefined;
  }

  private toMetadata(candidate: Record<string, unknown>): Record<string, unknown> | undefined {
    if (candidate['metadata'] && typeof candidate['metadata'] === 'object') {
      return candidate['metadata'] as Record<string, unknown>;
    }

    return undefined;
  }

  private toEpochMilliseconds(value: unknown): number {
    if (typeof value === 'number') {
      return value > 10_000_000_000 ? value : value * 1000;
    }

    if (typeof value === 'string') {
      const numericValue = Number(value);
      if (!Number.isNaN(numericValue)) {
        return numericValue > 10_000_000_000 ? numericValue : numericValue * 1000;
      }

      const parsed = Date.parse(value);
      return Number.isNaN(parsed) ? Number.NaN : parsed;
    }

    return Number.NaN;
  }

  private toString(value: unknown): string | undefined {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value;
    }

    return undefined;
  }
}
