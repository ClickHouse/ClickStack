import { resolveUpdatedPassword } from '@/controllers/connection';

describe('resolveUpdatedPassword', () => {
  const existing = { host: 'https://ch.example.com:8443', password: 'stored' };

  it('uses a password sent in the update', () => {
    expect(
      resolveUpdatedPassword(existing, {
        host: 'https://new.example.com:8443',
        password: 'new',
      }),
    ).toBe('new');
  });

  it('keeps the stored password when the host is unchanged', () => {
    expect(resolveUpdatedPassword(existing, { host: existing.host })).toBe(
      'stored',
    );
    expect(resolveUpdatedPassword(existing, {})).toBe('stored');
  });

  it('does not treat trailing slashes as a host change', () => {
    expect(
      resolveUpdatedPassword(existing, { host: `${existing.host}//` }),
    ).toBe('stored');
  });

  it('rejects a host change without the password', () => {
    const host = 'https://attacker.example.com:8443';
    expect(resolveUpdatedPassword(existing, { host })).toBeUndefined();
    expect(
      resolveUpdatedPassword(existing, { host, password: '' }),
    ).toBeUndefined();
  });

  it('allows a host change when no password is stored', () => {
    const host = 'https://new.example.com:8443';
    expect(
      resolveUpdatedPassword({ ...existing, password: '' }, { host }),
    ).toBe('');
    expect(resolveUpdatedPassword({ host: existing.host }, { host })).toBe('');
  });

  it('clears the stored password when a Prometheus endpoint changes host', () => {
    const host = 'http://thanos:10902';
    expect(
      resolveUpdatedPassword(existing, { host, isPrometheusEndpoint: true }),
    ).toBe('');
    expect(
      resolveUpdatedPassword(
        { ...existing, isPrometheusEndpoint: true },
        { host },
      ),
    ).toBe('');
    expect(
      resolveUpdatedPassword(
        { ...existing, isPrometheusEndpoint: true },
        { host, isPrometheusEndpoint: false },
      ),
    ).toBeUndefined();
  });
});
