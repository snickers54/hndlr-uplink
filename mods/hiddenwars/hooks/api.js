// HiddenWars API client for the HNDLR uplink mod.
//
// This module is deliberately free of the mods API (`$`): the host's
// `$.http.fetch`, token storage and base-URL config are injected by
// register.js, so everything here is plain, testable JavaScript.
//
// Auth model (matches the game backend):
//   POST /auth/login          {email, password} -> {token, refresh_token}
//                             or {requires_2fa, totp_session}
//   POST /auth/totp/login     {totp_session, code} -> {token, refresh_token}
//   POST /auth/refresh        {refresh_token} -> {token, refresh_token}
//                             (refresh token rotates on every call)
//   POST /auth/device/start   -> pairing URL + codes (browser login flow)
//   POST /auth/device/poll    {device_code} -> pending | tokens
// Access tokens live 1h; refresh tokens 30d. The client retries once on a
// 401 by refreshing first.

export const DEFAULT_BASE = 'https://api.hiddenwars.io'

export class ApiError extends Error {
  constructor(message, status, code) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code || ''
  }
}

export function createClient({ base, http, getTokens, setTokens }) {
  const root = String(base || DEFAULT_BASE).replace(/\/+$/, '')

  async function request(path, { method, body, auth = true, retry = true } = {}) {
    const headers = {
      'Content-Type': 'application/json',
      'User-Agent': 'hiddenwars-uplink/0.4 (claude-code-mod)',
      'X-Client-Source': 'claude-code-mod',
    }
    if (auth) {
      const tokens = await getTokens()
      if (tokens && tokens.token) headers.Authorization = 'Bearer ' + tokens.token
    }
    const res = await http(root + path, {
      method: method || 'GET',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })

    if (res.status === 401 && auth && retry) {
      const refreshed = await refresh()
      if (refreshed) return request(path, { method, body, auth, retry: false })
    }

    let json = null
    try {
      json = res.text ? JSON.parse(res.text) : null
    } catch {
      json = null
    }
    if (!res.ok) {
      const message = (json && json.message) || 'request failed (' + res.status + ')'
      const code = (json && json.error) || ''
      throw new ApiError(message, res.status, code)
    }
    return json
  }

  async function refresh() {
    const tokens = await getTokens()
    if (!tokens || !tokens.refresh_token) return false
    const res = await http(root + '/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: tokens.refresh_token }),
    })
    if (!res.ok) {
      // The stored refresh token is dead or rotated away; the session is over.
      await setTokens(null)
      throw new ApiError('Session expired — run /hw login', 401, 'SESSION_EXPIRED')
    }
    const json = JSON.parse(res.text)
    await setTokens({ token: json.token, refresh_token: json.refresh_token })
    return true
  }

  return {
    // login() resolves {ok:true} on success or {requires2fa:true, totpSession}
    // when the account has 2FA. Throws ApiError with the server's message
    // (invalid credentials, email not verified, ...) otherwise.
    async login(email, password) {
      const json = await request('/auth/login', {
        method: 'POST',
        body: { email: String(email).toLowerCase(), password },
        auth: false,
      })
      if (json && json.requires_2fa) {
        return { requires2fa: true, totpSession: json.totp_session }
      }
      await setTokens({ token: json.token, refresh_token: json.refresh_token })
      return { ok: true }
    },

    async totpLogin(totpSession, code) {
      const json = await request('/auth/totp/login', {
        method: 'POST',
        body: { totp_session: totpSession, code },
        auth: false,
      })
      await setTokens({ token: json.token, refresh_token: json.refresh_token })
      return { ok: true }
    },

    async logout() {
      const tokens = await getTokens()
      try {
        await request('/auth/logout', {
          method: 'POST',
          body: tokens && tokens.refresh_token ? { refresh_token: tokens.refresh_token } : {},
        })
      } catch {
        // Best-effort: the server may already be unreachable; clear locally
        // regardless.
      }
      await setTokens(null)
    },

    // Device pairing (RFC 8628 subset): the browser-login path behind
    // /hw login. start() mints a grant and returns everything the terminal
    // needs to print the pairing URL; poll() is called on a clock until the
    // player approves the code at the verification page.
    async deviceStart() {
      const json = await request('/auth/device/start', {
        method: 'POST',
        body: { client_label: 'claude-code-mod' },
        auth: false,
      })
      return {
        deviceCode: json.device_code,
        userCode: json.user_code,
        verificationUri: json.verification_uri,
        verificationUriComplete: json.verification_uri_complete,
        expiresAt: Date.now() + (json.expires_in || 600) * 1000,
        intervalMs: (json.interval || 5) * 1000,
      }
    },

    // poll() never throws for flow states: pending / slowDown / expired are
    // returned as {status}. Only real failures (network, server 5xx) throw,
    // which the caller treats as transient and retries on the next tick.
    async devicePoll(deviceCode) {
      try {
        const json = await request('/auth/device/poll', {
          method: 'POST',
          body: { device_code: deviceCode },
          auth: false,
        })
        await setTokens({ token: json.token, refresh_token: json.refresh_token })
        return { status: 'ok' }
      } catch (err) {
        if (err instanceof ApiError) {
          if (err.code === 'authorization_pending') return { status: 'pending' }
          if (err.code === 'slow_down') return { status: 'slowDown' }
          if (err.code === 'expired_token') return { status: 'expired' }
        }
        throw err
      }
    },

    get(path) {
      return request(path)
    },

    markAllRead() {
      return request('/player/notifications/read', { method: 'PUT' })
    },
  }
}
