export type RuntimeConfig = {
  frigateBaseUrl: string;
  proxyBaseUrl?: string;
  deploymentMode: 'direct' | 'proxy';
  authMode: 'none' | 'header' | 'cookie';
  previewFramesEnabled: boolean;
  reviewOverlayEnabled: boolean;
  requestTimeoutMs: number;
  mqtt?: {
    enabled: boolean;
    brokerUrl: string;
    brokerPort: number;
    username?: string;
    password?: string;
    useTls?: boolean;
    clientId?: string;
    topicPattern: string;
    reconnectIntervalMs?: number;
    maxReconnectAttempts?: number;
  };
};

export const defaultRuntimeConfig: RuntimeConfig = {
  frigateBaseUrl: '',
  deploymentMode: 'direct',
  authMode: 'none',
  previewFramesEnabled: true,
  reviewOverlayEnabled: true,
  requestTimeoutMs: 15000,
  mqtt: {
    enabled: false,
    brokerUrl: 'ws://broker.hivemq.com:8000/mqtt',
    brokerPort: 8000,
    useTls: false,
    topicPattern: 'reolink/+/events'
  }
};
