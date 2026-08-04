import type { SessionClientType } from '../../../../../infrastructure/database/enums';

export interface AudienceSettings {
  readonly audienceWeb: string;
  readonly audienceScanner: string;
}

/**
 * One audience per client type, so a scanner token is not accepted by the web
 * API and the reverse. The value is chosen from the session's client type, not
 * from anything the caller sends.
 */
export function audienceFor(
  clientType: SessionClientType,
  settings: AudienceSettings,
): string {
  return clientType === 'MOBILE_SCANNER'
    ? settings.audienceScanner
    : settings.audienceWeb;
}
