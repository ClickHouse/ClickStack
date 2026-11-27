import { getAgent, getLoggedInAgent, getServer } from '@/fixtures';

// Malformed JSON answers 400 only if the parser ran, so an anonymous 401 shows
// the body was never read.
const MALFORMED_JSON = '{"a":';
const OVER_PUBLIC_LIMIT = `{"a":"${'x'.repeat(200 * 1024)}"`;

describe('request body parsing', () => {
  const server = getServer();
  let signedInAgent: ReturnType<typeof getAgent>;

  beforeAll(async () => {
    await server.start();
    ({ agent: signedInAgent } = await getLoggedInAgent(server));
  });

  afterAll(async () => {
    await server.clearDBs();
    await server.stop();
  });

  it.each(['/dashboards', '/api/v2/dashboards', '/mcp'])(
    'rejects an anonymous POST to %s without parsing its body',
    async path => {
      await getAgent(server)
        .post(path)
        .set('Content-Type', 'application/json')
        .send(MALFORMED_JSON)
        .expect(401);
    },
  );

  it.each(['/register/password', '/team/setup/some-token'])(
    'caps public bodies on %s at 100kb',
    async path => {
      await getAgent(server)
        .post(path)
        .set('Content-Type', 'application/json')
        .send(OVER_PUBLIC_LIMIT)
        .expect(413);
    },
  );

  // The login route's own error handlers turn the 413 into a redirect.
  it('sends an oversized login back to the login page', async () => {
    const res = await getAgent(server)
      .post('/login/password')
      .set('Content-Type', 'application/json')
      .send(OVER_PUBLIC_LIMIT)
      .expect(303);
    expect(res.headers.location).toContain('/login?err=unknown');
  });

  it('parses bodies over 100kb once signed in', async () => {
    await signedInAgent
      .post('/dashboards')
      .set('Content-Type', 'application/json')
      .send(OVER_PUBLIC_LIMIT)
      .expect(400);
  });
});
