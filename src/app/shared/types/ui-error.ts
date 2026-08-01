export type UiErrorCode =
  | 'AUTH_REQUIRED'
  | 'ACCESS_DENIED'
  | 'CAMERA_NOT_FOUND'
  | 'NO_DATA_IN_RANGE'
  | 'PLAYBACK_SOURCE_UNAVAILABLE'
  | 'NETWORK_FAILURE'
  | 'UNKNOWN_FAILURE';

export type UiError = {
  code: UiErrorCode;
  message: string;
  retryable: boolean;
};