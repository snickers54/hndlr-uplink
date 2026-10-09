import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createClient, ApiError } from '../hooks/api.js'

// A fake $.http.fetch: routes on method+path, records calls, serves canned
// responses. Tokens live in a plain object like the real store would hold.
function makeFixture(routes) {
  const calls = []
  let tokens = null
  const http = async (url, init = {}) => {
    const path = url.replace(/^https?:\/\/[^/]+/, '')
    calls.push({ method: init.method || 'GET', path, body: init.body })
    const key = (init.method || 'GET') + ' ' + path.split('?')[0]
    const handler = routes[key]
    if (!handler) return { status: 404, ok: false, headers: {}, text: '' }
    const r = handler(init, tokens)
    return { status: r.status, ok: r.status >= 200 && r.status < 300, headers: {}, text: r.text || '' }
  }
  const client = createClient({
    base: 'https://api.example.com',
    http,
    getTokens: async () => tokens,
    setTokens: async (t) => { tokens = t },
  })
  return { client, calls, get tokens() { return tokens } }
}

test('login stores the token pair', async () => {
  const f = makeFixture({
    'POST /auth/login': () => ({ status: 200, text: JSON.stringify({ token: 'at', refresh_token: 'rt', message: 'ok' }) }),
  })
  const res = await f.client.login('OP@Example.com', 'pw')
  assert.equal(res.ok, true)
  assert.deepEqual(f.tokens, { token: 'at', refresh_token: 'rt' })
  const login = f.calls[0]
  assert.equal(login.path, '/auth/login')
  assert.deepEqual(JSON.parse(login.body), { email: 'op@example.com', password: 'pw' })
})

test('login surfaces a 2FA pre-auth session instead of tokens', async () => {
  const f = makeFixture({
    'POST /auth/login': () => ({ status: 200, text: JSON.stringify({ requires_2fa: true, totp_session: 'pre' }) }),
    'POST /auth/totp/login': () => ({ status: 200, text: JSON.stringify({ token: 'at2', refresh_token: 'rt2' }) }),
  })
  const res = await f.client.login('op@example.com', 'pw')
  assert.equal(res.requires2fa, true)
  assert.equal(res.totpSession, 'pre')
  assert.equal(f.tokens, null)
  const done = await f.client.totpLogin(res.totpSession, '123456')
  assert.equal(done.ok, true)
  assert.deepEqual(JSON.parse(f.calls[1].body), { totp_session: 'pre', code: '123456' })
})

test('server error messages come through as ApiError', async () => {
  const f = makeFixture({
    'POST /auth/login': () => ({ status: 401, text: JSON.stringify({ error: 'INVALID_CREDENTIALS', message: 'Invalid username or password' }) }),
  })
  await assert.rejects(f.client.login('op@example.com', 'nope'), (err) => {
    assert.ok(err instanceof ApiError)
    assert.equal(err.status, 401)
    assert.equal(err.code, 'INVALID_CREDENTIALS')
    assert.equal(err.message, 'Invalid username or password')
    return true
  })
})

test('a 401 GET refreshes the rotating token and retries once', async () => {
  let tokens = { token: 'stale', refresh_token: 'rt1' }
  let playerCalls = 0
  const c = createClient({
    base: 'https://api.example.com',
    http: async (url, init = {}) => {
      const path = url.replace(/^https?:\/\/[^/]+/, '')
      if (path === '/player') {
        playerCalls += 1
        if ((init.headers || {}).Authorization === 'Bearer stale') {
          return { status: 401, ok: false, headers: {}, text: '' }
        }
        return { status: 200, ok: true, headers: {}, text: JSON.stringify({ player: { username: 'S4B3R' } }) }
      }
      if (path === '/auth/refresh') {
        assert.deepEqual(JSON.parse(init.body), { refresh_token: tokens.refresh_token })
        return { status: 200, ok: true, headers: {}, text: JSON.stringify({ token: 'at2', refresh_token: 'rt2' }) }
      }
      return { status: 404, ok: false, headers: {}, text: '' }
    },
    getTokens: async () => tokens,
    setTokens: async (t) => { tokens = t },
  })
  const me = await c.get('/player')
  assert.equal(me.player.username, 'S4B3R')
  assert.equal(playerCalls, 2) // rejected once with the stale token, retried with the fresh one
  assert.deepEqual(tokens, { token: 'at2', refresh_token: 'rt2' })
})

test('a dead refresh token clears the session and raises SESSION_EXPIRED', async () => {
  let tokens = { token: 'at1', refresh_token: 'rt-dead' }
  const c = createClient({
    base: 'https://api.example.com',
    http: async (url) => {
      const path = url.replace(/^https?:\/\/[^/]+/, '')
      if (path === '/auth/refresh') return { status: 401, ok: false, headers: {}, text: '' }
      return { status: 401, ok: false, headers: {}, text: '' }
    },
    getTokens: async () => tokens,
    setTokens: async (t) => { tokens = t },
  })
  await assert.rejects(c.get('/player'), (err) => {
    assert.equal(err.code, 'SESSION_EXPIRED')
    return true
  })
  assert.equal(tokens, null)
})

test('logout clears tokens even when the server is unreachable', async () => {
  let tokens = { token: 'at', refresh_token: 'rt' }
  const c = createClient({
    base: 'https://api.example.com',
    http: async () => { throw new Error('network down') },
    getTokens: async () => tokens,
    setTokens: async (t) => { tokens = t },
  })
  await c.logout()
  assert.equal(tokens, null)
})

test('markAllRead PUTs the read-all endpoint', async () => {
  const f = makeFixture({
    'PUT /player/notifications/read': () => ({ status: 204, text: '' }),
  })
  await f.client.markAllRead()
  assert.equal(f.calls[0].method, 'PUT')
  assert.equal(f.calls[0].path, '/player/notifications/read')
})

test('requests carry the uplink identity headers', async () => {
  const f = makeFixture({
    'POST /auth/login': () => ({ status: 200, text: JSON.stringify({ token: 'at', refresh_token: 'rt' }) }),
  })
  await f.client.login('op@example.com', 'pw')
  // The fake http records method/path/body; headers are asserted here via a
  // dedicated pass-through check.
  let seenHeaders = null
  const c2 = createClient({
    base: 'https://api.example.com',
    http: async (url, init) => {
      seenHeaders = init.headers
      return { status: 200, ok: true, headers: {}, text: JSON.stringify({}) }
    },
    getTokens: async () => null,
    setTokens: async () => {},
  })
  await c2.get('/player')
  assert.equal(seenHeaders['User-Agent'], 'hiddenwars-uplink/0.4 (claude-code-mod)')
  assert.equal(seenHeaders['X-Client-Source'], 'claude-code-mod')
  assert.equal(seenHeaders.Authorization, undefined)
})

// ---- device pairing (browser login) -------------------------------------------

const deviceStartPayload = {
  device_code: 'dev-raw',
  user_code: 'K7QX-M2RP',
  verification_uri: 'https://hiddenwars.io/#/link',
  verification_uri_complete: 'https://hiddenwars.io/#/link?code=K7QX-M2RP',
  expires_in: 600,
  interval: 5,
}

test('deviceStart maps the RFC 8628 payload and labels the client', async () => {
  const f = makeFixture({
    'POST /auth/device/start': () => ({ status: 200, text: JSON.stringify(deviceStartPayload) }),
  })
  const start = await f.client.deviceStart()
  assert.equal(start.deviceCode, 'dev-raw')
  assert.equal(start.userCode, 'K7QX-M2RP')
  assert.equal(start.verificationUriComplete, 'https://hiddenwars.io/#/link?code=K7QX-M2RP')
  assert.equal(start.intervalMs, 5000)
  assert.ok(start.expiresAt > Date.now() + 590 * 1000)
  assert.deepEqual(JSON.parse(f.calls[0].body), { client_label: 'claude-code-mod' })
})

test('devicePoll maps authorization_pending without throwing', async () => {
  const f = makeFixture({
    'POST /auth/device/poll': () => ({ status: 400, text: JSON.stringify({ error: 'authorization_pending' }) }),
  })
  const res = await f.client.devicePoll('dev-raw')
  assert.equal(res.status, 'pending')
  assert.deepEqual(JSON.parse(f.calls[0].body), { device_code: 'dev-raw' })
  assert.equal(f.tokens, null)
})

test('devicePoll maps slow_down and expired_token as flow states', async () => {
  const f = makeFixture({
    'POST /auth/device/poll': () => ({ status: 400, text: JSON.stringify({ error: 'slow_down' }) }),
  })
  assert.equal((await f.client.devicePoll('dev-raw')).status, 'slowDown')

  const f2 = makeFixture({
    'POST /auth/device/poll': () => ({ status: 400, text: JSON.stringify({ error: 'expired_token' }) }),
  })
  assert.equal((await f2.client.devicePoll('dev-raw')).status, 'expired')
})

test('devicePoll stores the token pair on success', async () => {
  const f = makeFixture({
    'POST /auth/device/poll': () => ({ status: 200, text: JSON.stringify({ token: 'at', refresh_token: 'rt' }) }),
  })
  const res = await f.client.devicePoll('dev-raw')
  assert.equal(res.status, 'ok')
  assert.deepEqual(f.tokens, { token: 'at', refresh_token: 'rt' })
})

test('devicePoll rethrows non-flow failures for the caller to retry', async () => {
  const f = makeFixture({
    'POST /auth/device/poll': () => ({ status: 500, text: JSON.stringify({ error: 'INTERNAL_ERROR' }) }),
  })
  await assert.rejects(f.client.devicePoll('dev-raw'), (err) => err instanceof ApiError && err.status === 500)
})
