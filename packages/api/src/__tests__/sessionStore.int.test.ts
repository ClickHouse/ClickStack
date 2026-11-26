import mongoose from 'mongoose';

import { SESSION_TOUCH_AFTER_SEC } from '@/config';
import { getAgent, getServer } from '@/fixtures';
import { backfillSessionLastModified } from '@/migrations';

const CREDENTIALS = {
  email: 'session-store@example.com',
  password: 'TacoCat!2#4X',
};

const sessions = () =>
  mongoose.connection.db!.collection<{ _id: string; expires: Date }>(
    'sessions',
  );

describe('session store writes', () => {
  const server = getServer();

  beforeAll(async () => {
    await server.start();
  });

  afterEach(async () => {
    await server.clearDBs();
  });

  afterAll(async () => {
    await server.stop();
  });

  // Registering also signs the user in.
  const login = async () => {
    const agent = getAgent(server);
    const res = await agent
      .post('/register/password')
      .send({ ...CREDENTIALS, confirmPassword: CREDENTIALS.password })
      .expect(200);
    const sid = decodeURIComponent(String(res.headers['set-cookie'])).match(
      /connect\.sid[^=]*=s:([^.]+)/,
    )![1];
    return { agent, sid };
  };

  const storedExpiry = async (sid: string) =>
    (await sessions().findOne({ _id: sid }))?.expires;

  it('does not rewrite the session on every request', async () => {
    const { agent, sid } = await login();
    const before = await storedExpiry(sid);
    expect(before).toBeInstanceOf(Date);

    for (let i = 0; i < 3; i++) {
      await agent.get('/me').expect(200);
    }

    expect(await storedExpiry(sid)).toEqual(before);
  });

  it('stops rewriting sessions stored before touchAfter once backfilled', async () => {
    const { agent, sid } = await login();
    await sessions().updateOne({ _id: sid }, { $unset: { lastModified: '' } });

    await backfillSessionLastModified();
    // The first request touches it once; later ones skip.
    await agent.get('/me').expect(200);
    const before = await storedExpiry(sid);
    await agent.get('/me').expect(200);

    expect(await storedExpiry(sid)).toEqual(before);
  });

  it('extends the session once the touch interval has passed', async () => {
    const { agent, sid } = await login();
    const stale = new Date(Date.now() - (SESSION_TOUCH_AFTER_SEC + 60) * 1000);
    await sessions().updateOne({ _id: sid }, { $set: { lastModified: stale } });
    const before = await storedExpiry(sid);

    await agent.get('/me').expect(200);

    expect((await storedExpiry(sid))!.getTime()).toBeGreaterThan(
      before!.getTime(),
    );
  });
});
