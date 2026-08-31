import {
  describeBrowser,
  describeDevice,
  EmailEventPublisher,
  formatDuration,
  maskIpAddress,
} from './email-event.publisher';

describe('email security metadata', () => {
  it('masks IPv4 and IPv6 addresses', () => {
    expect(maskIpAddress('197.24.18.42')).toBe('197.***.***.42');
    expect(maskIpAddress('2001:db8:1234:5678::42')).toBe(
      '2001:db8:****:****:42',
    );
    expect(maskIpAddress(null)).toBe('Non disponible');
  });

  it('derives restrained device labels without exposing the full user agent', () => {
    const agent =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit Chrome/151.2.3 Safari/537.36';
    expect(describeBrowser(agent)).toBe('Chrome 151.2.3');
    expect(describeDevice(agent)).toBe('Chrome 151.2.3 sur Windows');
  });

  it('formats expiry without leaking implementation timestamps', () => {
    expect(formatDuration(1_800)).toBe('30 minute(s)');
    expect(formatDuration(86_400)).toBe('1 jour(s)');
  });

  it('does not roll back a business event when queueing is unavailable', async () => {
    const enqueue = jest.fn().mockRejectedValue(new Error('redis unavailable'));
    const logger = { info: jest.fn(), error: jest.fn() };
    const publisher = new EmailEventPublisher(
      {
        user: {
          findFirst: jest.fn().mockResolvedValue({
            primaryEmail: 'mehdi@example.com',
            firstName: 'Mehdi',
          }),
        },
      } as never,
      { webBaseUrl: 'https://app.eventini.test' } as never,
      { enqueue } as never,
      logger as never,
    );

    await expect(
      publisher.publish({
        type: 'PASSWORD_RESET_REQUESTED',
        userId: 'usr_test',
        resetToken: 'raw-secret-token',
        expiresInSeconds: 1_800,
        occurredAt: new Date('2026-08-16T12:00:00Z'),
      }),
    ).resolves.toBeUndefined();

    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain(
      'raw-secret-token',
    );
  });
});
