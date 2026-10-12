'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSession, decodeJwtPayload, AuthRequiredError } = require('../lib/auth.js');

const API = 'https://api.test';

function jwt(claims) {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${enc({ alg: 'HS256' })}.${enc(claims)}.sig`;
}

function memoryStore(initial = {}) {
  let state = { ...initial };
  return {
    get: async () => ({ ...state }),
    set: async (partial) => { state = { ...state, ...partial }; },
    clear: async () => { state = {}; },
    peek: () => state,
  };
}

function json(status, body) {
  return { status, ok: status >= 200 && status < 300, json: async () => body };
}

/** A fake API. `routes` maps "METHOD /path" to (init) => response (or a Promise of one). */
function fakeApi(routes) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const key = `${init.method || 'GET'} ${url.replace(API, '')}`;
    calls.push({ key, auth: init.headers && init.headers.Authorization, body: init.body });
    const route = routes[key];
    if (!route) throw new Error(`unexpected request ${key}`);
    return route(init);
  };
  return { fetchImpl, calls };
}

function session(store, api, onSignedOut = () => {}) {
  return createSession({ fetchImpl: api.fetchImpl, store, getApiBase: async () => API, onSignedOut });
}

const deferred = () => {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
};

test('concurrent 401s share one refresh, and every request is retried with the new token', async () => {
  const store = memoryStore({ accessToken: 'old', refreshToken: 'r1', userId: '7' });
  const gate = deferred();
  const api = fakeApi({
    'GET /api/x': (init) => json(init.headers.Authorization === 'Bearer new' ? 200 : 401, { ok: true }),
    'POST /api/auth/refresh': async () => { await gate.promise; return json(200, { access_token: 'new', refresh_token: 'r2' }); },
  });
  const s = session(store, api);
  const pending = [s.apiFetch('/api/x'), s.apiFetch('/api/x'), s.apiFetch('/api/x')];
  await new Promise((r) => setTimeout(r, 10));
  gate.resolve();
  const results = await Promise.all(pending);

  assert.deepEqual(results.map((r) => r.status), [200, 200, 200]);
  const refreshes = api.calls.filter((c) => c.key === 'POST /api/auth/refresh');
  assert.equal(refreshes.length, 1);
  assert.equal(refreshes[0].auth, 'Bearer r1', 'the refresh token goes in the Authorization header');
  assert.equal(refreshes[0].body, undefined, 'no body');
  assert.deepEqual(store.peek(), { accessToken: 'new', refreshToken: 'r2', userId: '7' }, 'the rotated pair is stored together');
});

test('a request that raced a finished refresh reuses the new token instead of refreshing again', async () => {
  const store = memoryStore({ accessToken: 'old', refreshToken: 'r1' });
  const api = fakeApi({
    'GET /api/x': async (init) => {
      if (init.headers.Authorization === 'Bearer old') {
        await store.set({ accessToken: 'fresh', refreshToken: 'r2' }); // another caller refreshed meanwhile
        return json(401, {});
      }
      return json(200, {});
    },
  });
  const res = await session(store, api).apiFetch('/api/x');
  assert.equal(res.status, 200);
  assert.equal(api.calls.filter((c) => c.key === 'POST /api/auth/refresh').length, 0);
});

test('a rejected refresh token signs out and asks for a sign-in', async () => {
  const store = memoryStore({ accessToken: 'old', refreshToken: 'spent', userId: '7' });
  let signedOut = 0;
  const api = fakeApi({
    'GET /api/x': () => json(401, {}),
    'POST /api/auth/refresh': () => json(401, { error: 'invalid_refresh_token' }),
  });
  await assert.rejects(session(store, api, () => { signedOut += 1; }).apiFetch('/api/x'), AuthRequiredError);
  assert.deepEqual(store.peek(), {});
  assert.equal(signedOut, 1);
});

test('a server or network error during refresh keeps the session', async () => {
  for (const failure of [() => json(503, {}), () => { throw new TypeError('Failed to fetch'); }]) {
    const store = memoryStore({ accessToken: 'old', refreshToken: 'r1' });
    const api = fakeApi({ 'GET /api/x': () => json(401, {}), 'POST /api/auth/refresh': failure });
    await assert.rejects(session(store, api).apiFetch('/api/x'), (e) => !(e instanceof AuthRequiredError));
    assert.equal(store.peek().refreshToken, 'r1');
  }
});

test('without an access token (browser restart) it refreshes first', async () => {
  const store = memoryStore({ refreshToken: 'r1' });
  const api = fakeApi({
    'POST /api/auth/refresh': () => json(200, { access_token: 'a2', refresh_token: 'r2' }),
    'GET /api/x': (init) => json(init.headers.Authorization === 'Bearer a2' ? 200 : 401, {}),
  });
  assert.equal((await session(store, api).apiFetch('/api/x')).status, 200);
  assert.deepEqual(api.calls.map((c) => c.key), ['POST /api/auth/refresh', 'GET /api/x']);
});

test('without any session it asks for a sign-in and calls nothing', async () => {
  const api = fakeApi({});
  await assert.rejects(session(memoryStore(), api).apiFetch('/api/x'), AuthRequiredError);
  assert.equal(api.calls.length, 0);
});

test('a refresh finishing after sign-out does not bring the session back', async () => {
  const store = memoryStore({ accessToken: 'old', refreshToken: 'r1' });
  const gate = deferred();
  const api = fakeApi({
    'GET /api/x': () => json(401, {}),
    'POST /api/auth/refresh': async () => { await gate.promise; return json(200, { access_token: 'a2', refresh_token: 'r2' }); },
  });
  const pending = session(store, api).apiFetch('/api/x');
  await new Promise((r) => setTimeout(r, 10));
  await store.clear();
  gate.resolve();
  await assert.rejects(pending, AuthRequiredError);
  assert.deepEqual(store.peek(), {});
});

test('the web session is forked, never stored, and only once per user', async () => {
  const web = jwt({ sub: '7', type: 'refresh' });
  const store = memoryStore();
  const api = fakeApi({
    'POST /api/auth/fork-session': () => json(200, { access_token: 'ext-a', refresh_token: 'ext-r', user: { id: 7 } }),
  });
  const s = session(store, api);
  assert.deepEqual(await Promise.all([s.adoptWebSession(web), s.adoptWebSession(web)]), ['adopted', 'adopted']);
  assert.equal(api.calls.length, 1, 'concurrent hand-offs share one fork');
  assert.equal(api.calls[0].auth, `Bearer ${web}`);
  assert.deepEqual(store.peek(), { accessToken: 'ext-a', refreshToken: 'ext-r', userId: '7' });

  // The web app rotating its token later changes nothing for the extension.
  assert.equal(await s.adoptWebSession(jwt({ sub: '7', jti: 'next' })), 'unchanged');
  assert.equal(api.calls.length, 1);
});

test('a hand-off for another user replaces the session; a rejected one changes nothing', async () => {
  const store = memoryStore({ accessToken: 'a', refreshToken: 'r', userId: '7' });
  let fork = () => json(401, {});
  const api = fakeApi({ 'POST /api/auth/fork-session': () => fork() });
  const s = session(store, api);

  assert.equal(await s.adoptWebSession(jwt({ sub: '8' })), 'rejected');
  assert.equal(store.peek().userId, '7');

  fork = () => json(200, { access_token: 'a8', refresh_token: 'r8', user: { id: 8 } });
  assert.equal(await s.adoptWebSession(jwt({ sub: '8' })), 'adopted');
  assert.deepEqual(store.peek(), { accessToken: 'a8', refreshToken: 'r8', userId: '8' });

  assert.equal(await s.adoptWebSession('not-a-jwt'), 'ignored');
});

test('sign-out revokes the session on the server and clears it locally', async () => {
  const store = memoryStore({ accessToken: 'a', refreshToken: 'r' });
  const api = fakeApi({ 'POST /api/auth/logout': () => json(200, {}) });
  await session(store, api).signOut();
  assert.deepEqual(api.calls.map((c) => [c.key, c.auth]), [['POST /api/auth/logout', 'Bearer a']]);
  assert.deepEqual(store.peek(), {});
});

test('password sign-in stores the pair and the user id', async () => {
  const store = memoryStore();
  const api = fakeApi({
    'POST /api/auth/login': (init) => {
      assert.deepEqual(JSON.parse(init.body), { email: 'a@b.c', password: 'pw' });
      return json(200, { access_token: 'a', refresh_token: 'r', user: { id: 3 } });
    },
  });
  await session(store, api).signInWithPassword('a@b.c', 'pw');
  assert.deepEqual(store.peek(), { accessToken: 'a', refreshToken: 'r', userId: '3' });
});

test('decodeJwtPayload reads base64url claims and rejects garbage', () => {
  assert.deepEqual(decodeJwtPayload(jwt({ sub: '7', name: 'Zoë ✓' })), { sub: '7', name: 'Zoë ✓' });
  for (const bad of ['', 'abc', 'a.b.c', null, undefined, 'a.' + Buffer.from('[1]').toString('base64url') + '.c']) {
    assert.equal(decodeJwtPayload(bad), null, String(bad));
  }
});

test('a retry wake-up is scheduled before each refresh and cancelled once it settles', async () => {
  for (const [status, expectOk] of [[200, true], [503, false]]) {
    const store = memoryStore({ refreshToken: 'r1', userId: '7' });
    const events = [];
    const api = fakeApi({
      'POST /api/auth/refresh': async () => {
        events.push('request');
        return json(status, { access_token: 'a2', refresh_token: 'r2' });
      },
    });
    const s = createSession({
      fetchImpl: api.fetchImpl, store, getApiBase: async () => API,
      onRefreshStart: () => events.push('start'),
      onRefreshSettled: () => events.push('settled'),
    });
    const outcome = await s.refresh().then(() => true, () => false);
    assert.equal(outcome, expectOk);
    assert.deepEqual(events, ['start', 'request', 'settled'], `HTTP ${status}`);
  }
});

test('a failing wake-up hook never breaks the refresh', async () => {
  const store = memoryStore({ refreshToken: 'r1' });
  const api = fakeApi({ 'POST /api/auth/refresh': () => json(200, { access_token: 'a2', refresh_token: 'r2' }) });
  const s = createSession({
    fetchImpl: api.fetchImpl, store, getApiBase: async () => API,
    onRefreshStart: () => { throw new Error('alarms unavailable'); },
    onRefreshSettled: () => Promise.reject(new Error('alarms unavailable')),
  });
  assert.equal(await s.refresh(), 'a2');
  assert.equal(store.peek().refreshToken, 'r2');
});
