export type RuntimeConfig = {
  frigateBaseUrl: string;
  proxyBaseUrl?: string;
  deploymentMode: 'direct' | 'proxy';
  authMode: 'none' | 'header' | 'cookie';
  previewFramesEnabled: boolean;
  reviewOverlayEnabled: boolean;
  requestTimeoutMs: number;
};

export const defaultRuntimeConfig: RuntimeConfig = {
  frigateBaseUrl: '',
  deploymentMode: 'direct',
  authMode: 'none',
  previewFramesEnabled: true,
  reviewOverlayEnabled: true,
  requestTimeoutMs: 15000
};