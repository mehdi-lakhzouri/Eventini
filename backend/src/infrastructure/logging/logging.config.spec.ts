import { buildPinoOptions, type LoggingSettings } from './logging.config';

function settings(overrides: Partial<LoggingSettings> = {}): LoggingSettings {
  return {
    level: 'info',
    format: 'json',
    pretty: false,
    serviceName: 'eventini-api',
    serviceVersion: '1.2.3',
    redactionEnabled: true,
    httpEnabled: true,
    httpSuccessEnabled: true,
    slowRequestThresholdMs: 1000,
    slowQueryThresholdMs: 500,
    debugModules: undefined,
    debugExpiresAt: undefined,
    environment: 'production',
    instanceId: 'api-7f8d96',
    ...overrides,
  };
}

describe('buildPinoOptions', () => {
  it('puts the §9.1 global fields on every line', () => {
    expect(buildPinoOptions(settings()).base).toEqual({
      service: 'eventini-api',
      serviceVersion: '1.2.3',
      environment: 'production',
      instanceId: 'api-7f8d96',
    });
  });

  it('emits the level as a name rather than a number', () => {
    const formatter = buildPinoOptions(settings()).formatters?.level;
    expect(formatter?.('warn', 40)).toEqual({ level: 'warn' });
  });

  // §39.5 — JSON in production, pretty only locally.
  it('never configures a pretty transport in production', () => {
    expect(buildPinoOptions(settings()).transport).toBeUndefined();
  });

  it('configures pino-pretty only when pretty and format agree', () => {
    expect(
      buildPinoOptions(settings({ pretty: true, format: 'pretty' })).transport,
    ).toMatchObject({ target: 'pino-pretty' });

    // Asking for pretty output while the format says JSON is a contradiction;
    // JSON wins, because a machine-unparseable log is the worse failure.
    expect(
      buildPinoOptions(settings({ pretty: true, format: 'json' })).transport,
    ).toBeUndefined();
  });

  it('applies redaction paths and the scrubbing formatter when enabled', () => {
    const options = buildPinoOptions(settings({ redactionEnabled: true }));

    expect(options.redact).toBeDefined();
    expect(options.formatters?.log).toBeDefined();
  });

  it('omits both when redaction is disabled', () => {
    // Only reachable in development and test — the environment rules refuse a
    // staging or production boot with redaction off.
    const options = buildPinoOptions(
      settings({ redactionEnabled: false, environment: 'development' }),
    );

    expect(options.redact).toBeUndefined();
    expect(options.formatters?.log).toBeUndefined();
  });

  it('honours the configured level', () => {
    expect(buildPinoOptions(settings({ level: 'silent' })).level).toBe(
      'silent',
    );
  });
});
