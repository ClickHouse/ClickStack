import { getAgent, getLoggedInAgent, getServer } from '@/fixtures';
import { LOGIN_MAX_FAILED_ATTEMPTS } from '@/routers/api/root';

const MOCK_USER = {
  email: 'login-limit@example.com',
  password: 'TacoCat!2#4X',
};

describe('POST /login/password rate limit', () => {
  const server = getServer();
  let signedInAgent: ReturnType<typeof getAgent>;

  beforeAll(async () => {
    await server.start();
    ({ agent: signedInAgent } = await getLoggedInAgent(server, MOCK_USER));
  });

  afterAll(async () => {
    await server.stop();
  });

  const login = (email: string, password: string) =>
    getAgent(server)
      .post('/login/password')
      .type('form')
      .send({ email, password });

  it('does not count successful logins', async () => {
    for (let i = 0; i <= LOGIN_MAX_FAILED_ATTEMPTS; i++) {
      const res = await login(MOCK_USER.email, MOCK_USER.password);
      expect(res.status).toBe(303);
      expect(res.headers.location).not.toContain('err=');
    }
  });

  it('blocks an email after too many failed attempts, even with the right password', async () => {
    for (let i = 0; i < LOGIN_MAX_FAILED_ATTEMPTS; i++) {
      const res = await login(MOCK_USER.email, 'wrong-password');
      expect(res.headers.location).toContain('/login?err=authFail');
    }

    const blocked = await login(MOCK_USER.email, MOCK_USER.password);
    expect(blocked.status).toBe(303);
    expect(blocked.headers.location).toContain('/login?err=tooManyAttempts');

    // Emails are case-insensitive, so another spelling shares the limit.
    const upper = await login(MOCK_USER.email.toUpperCase(), 'wrong-password');
    expect(upper.headers.location).toContain('/login?err=tooManyAttempts');
  });

  it('keeps a separate limit for each email', async () => {
    const res = await login('someone-else@example.com', 'wrong-password');
    expect(res.headers.location).toContain('/login?err=authFail');
  });

  it('counts failed attempts made from a signed-in session', async () => {
    const email = 'signed-in-target@example.com';
    for (let i = 0; i < LOGIN_MAX_FAILED_ATTEMPTS; i++) {
      await signedInAgent
        .post('/login/password')
        .type('form')
        .send({ email, password: 'wrong-password' });
    }

    const res = await login(email, 'wrong-password');
    expect(res.headers.location).toContain('/login?err=tooManyAttempts');
  });

  it('limits an email sent in the query string, as passport accepts it there', async () => {
    const query = { email: 'query-target@example.com', password: 'wrong' };
    // A new X-Forwarded-For each time, so falling back to req.ip can't limit it.
    const attempt = (i: number) =>
      getAgent(server)
        .post('/login/password')
        .set('X-Forwarded-For', `10.0.0.${i}`)
        .query(query);
    for (let i = 0; i < LOGIN_MAX_FAILED_ATTEMPTS; i++) {
      await attempt(i);
    }

    const res = await attempt(LOGIN_MAX_FAILED_ATTEMPTS);
    expect(res.headers.location).toContain('/login?err=tooManyAttempts');
  });

  it('answers JSON clients such as the CLI with a 429', async () => {
    const attempt = () =>
      getAgent(server)
        .post('/login/password')
        .send({ email: 'json-client@example.com', password: 'wrong-password' });
    for (let i = 0; i < LOGIN_MAX_FAILED_ATTEMPTS; i++) {
      await attempt();
    }

    const res = await attempt();
    expect(res.status).toBe(429);
    expect(res.body.error).toBe('tooManyAttempts');
    expect(res.body.message).toMatch(/too many failed login attempts/i);
  });
});
