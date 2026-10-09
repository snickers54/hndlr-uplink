// HNDLR uplink — a HiddenWars relay for Claude Code.
//
// Registers /hw: player stats, notifications, and a background uplink that
// keeps a status line under the prompt and toasts incoming alert-grade
// transmissions. Read-only against the game API (the only writes are the
// auth endpoints and an explicit `/hw read`).

import { createClient, DEFAULT_BASE } from './api.js'
import { compact, timeAgo, severityMark, row } from './format.js'

const DEFAULT_POLL_SEC = 60
const MIN_POLL_SEC = 30
const MAX_POLL_SEC = 3600
const SEEN_CAP = 200

let pollTimer = null
let failStreak = 0
let baseCache = DEFAULT_BASE
let loginFlow = null // { step, email, password, totpSession, error, prefill }

export function register(on) {
  on('session.start', async ($, e, next) => {
    const base = await $.store.get('hw.base')
    if (typeof base === 'string' && base) baseCache = base
    for (const spec of [
      { name: 'hw', description: 'HiddenWars uplink — operator stats & HNDLR notifications', argumentHint: '[status|notif [n]|read|login [email]|logout|poll <sec|off>|api <url>]' },
      { name: 'hiddenwars', description: 'HiddenWars uplink (alias of /hw)', argumentHint: '[status|notif [n]|read|login [email]|logout|poll <sec|off>|api <url>]' },
    ]) {
      try {
        await $.command.register(spec)
      } catch {
        // Name taken by another plugin; the other alias still works.
      }
    }
    await startPolling($)
    return next(e)
  })

  on('command.run', { command: 'hw' }, ($, e) =>
    respond($, e).catch((err) => ({ text: '◤ HW uplink error — ' + ((err && err.message) || String(err)) })))
  on('command.run', { command: 'hiddenwars' }, ($, e) =>
    respond($, e).catch((err) => ({ text: '◤ HW uplink error — ' + ((err && err.message) || String(err)) })))

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== 'hw-login' || !loginFlow) return next(e)
    const { Box, Text, Input, Button } = $.ui.resolve(e)
    const lines = []
    lines.push(Text({ bold: true, children: ['◤ HNDLR UPLINK — authenticate'] }))
    lines.push(Text({ dimColor: true, children: ['Credentials go to ' + baseCache + ' only. Fields are drawn as typed.'] }))
    lines.push(Text({ children: [''] }))

    if (loginFlow.step === 'email') {
      lines.push(Input({
        key: 'hw-email', label: 'email', placeholder: 'operator@hiddenwars.io',
        value: loginFlow.prefill || '', submitLabel: 'next', autoFocus: true,
        onSubmit: (v) => submitEmail($, v),
      }))
    } else if (loginFlow.step === 'password') {
      lines.push(Text({ children: [loginFlow.email] }))
      lines.push(Input({
        key: 'hw-password', label: 'password', submitLabel: 'authenticate', autoFocus: true,
        onSubmit: (v) => submitPassword($, v),
      }))
    } else if (loginFlow.step === 'totp') {
      lines.push(Text({ children: [loginFlow.email + ' — 2FA enabled'] }))
      lines.push(Input({
        key: 'hw-totp', label: 'auth code', placeholder: '6 digits', submitLabel: 'verify', autoFocus: true,
        onSubmit: (v) => submitTotp($, v),
      }))
    } else if (loginFlow.step === 'busy') {
      lines.push(Text({ dimColor: true, children: ['authenticating…'] }))
    }

    if (loginFlow.error) {
      lines.push(Text({ children: [''] }))
      lines.push(Text({ color: 'red', children: [loginFlow.error] }))
    }
    lines.push(Text({ children: [''] }))
    lines.push(Button({ key: 'hw-cancel', label: 'cancel', onPress: () => cancelLogin($) }))
    return Box({ flexDirection: 'column', children: lines })
  })
}

async function respond($, e) {
  return { text: await handleCommand($, String(e.args || '')) }
}

async function handleCommand($, raw) {
  const parts = raw.trim().split(/\s+/).filter(Boolean)
  const sub = (parts[0] || 'status').toLowerCase()
  const tokens = await $.store.get('hw.tokens')

  if (sub === 'login') return startLogin($, parts[1])
  if (sub === 'logout') {
    if (!tokens) return 'Already logged out.'
    stopPolling()
    $.ui.status(undefined)
    await client($).logout()
    return '◤ HNDLR ◢ uplink severed. Run /hw login to reconnect.'
  }
  if (sub === 'help') return usage()
  if (sub === 'api') return setApi($, parts[1])

  if (!tokens) return 'No uplink session. Run /hw login first (or /hw help).'

  if (sub === 'poll') return setPoll($, parts[1])
  if (sub === 'read') {
    await client($).markAllRead()
    pollOnce($)
    return 'All notifications marked read.'
  }
  if (sub === 'notif' || sub === 'notifs' || sub === 'notifications') {
    const n = Math.min(50, Math.max(1, parseInt(parts[1], 10) || 10))
    return notifText(await client($).get('/player/notifications?limit=' + n))
  }
  if (sub === 'status') return statusText($)
  return usage()
}

function usage() {
  return [
    '◤ HNDLR UPLINK — commands',
    '  /hw              operator status (resources, heat, botnet, unread)',
    '  /hw notif [n]    latest n notifications (default 10)',
    '  /hw read         mark all notifications read',
    '  /hw login [email]  authenticate (password is asked for, never stored)',
    '  /hw logout       sever the uplink',
    '  /hw poll <sec|off>  background poll cadence (min ' + MIN_POLL_SEC + 's, default ' + DEFAULT_POLL_SEC + 's)',
    '  /hw api [url|reset] API base (default ' + DEFAULT_BASE + ')',
  ].join('\n')
}

// ---- status -----------------------------------------------------------------

async function statusText($) {
  const c = client($)
  const [me, notif, botnet] = await Promise.all([
    c.get('/player'),
    c.get('/player/notifications?limit=1'),
    c.get('/botnet/summary').catch(() => null),
  ])
  const p = (me && me.player) || {}
  const out = ['◤ HIDDENWARS UPLINK ─ ' + (p.username || 'operator') + (p.archetype ? ' (' + p.archetype + ')' : ''), '']
  out.push(row('crypto', compact(p.crypto) + (p.dirty_crypto ? ' (+' + compact(p.dirty_crypto) + ' dirty)' : '')))
  out.push(row('fragments', compact(p.fragments)))
  if (p.echoes) out.push(row('echoes', compact(p.echoes)))
  out.push(row('reputation', compact(p.reputation)))
  out.push(row('heat', String(p.heat)))
  if (p.subscription_tier && p.subscription_tier !== 'NONE') {
    const until = p.subscription_expires_at ? String(p.subscription_expires_at).slice(0, 10) : ''
    out.push(row('clearance', p.subscription_tier + (until ? ' — renews ' + until : '')))
  }
  if (botnet) {
    out.push(row('botnet', botnet.total_nodes + ' nodes · health ' + Math.round(botnet.aggregate_health || 0) + '%'
      + (botnet.critical_count ? ' · ' + botnet.critical_count + ' critical' : '')
      + (botnet.offline_count ? ' · ' + botnet.offline_count + ' offline' : '')))
  }
  const unread = notif ? notif.unread_count : 0
  out.push(row('notifications', unread + ' unread'))
  out.push('')
  out.push('  /hw notif — read transmissions · /hw read — clear the badge')
  return out.join('\n')
}

function notifText(notif) {
  const list = (notif && notif.notifications) || []
  if (!list.length) return 'No transmissions. The wire is quiet.'
  const out = list.map((n) => {
    const mark = n.read_at ? ' ' : '*'
    return ' ' + mark + ' ' + severityMark(n.severity) + ' ' + timeAgo(n.created_at).padStart(7) + '  ' + (n.title || n.type || 'transmission')
      + (n.body && !n.read_at ? '\n       ' + String(n.body).split('\n')[0] : '')
  })
  const unread = notif.unread_count || 0
  out.push('')
  out.push('  ' + unread + ' unread · * = new · /hw read clears the badge')
  return out.join('\n')
}

// ---- login ------------------------------------------------------------------

async function startLogin($, emailArg) {
  const tokens = await $.store.get('hw.tokens')
  if (tokens) return 'Already logged in. Run /hw logout first to switch operator.'

  // Headless path: /hw login email with HIDDENWARS_PASSWORD set in the env —
  // for players who don't want to type the password in a pane.
  const envPassword = await $.env.get('HIDDENWARS_PASSWORD')
  if (emailArg && envPassword) {
    const c = client($)
    const res = await c.login(emailArg, envPassword)
    if (res.requires2fa) {
      return '2FA is enabled on this account — rerun without HIDDENWARS_PASSWORD to enter a code: /hw login ' + emailArg
    }
    $.ui.toast('◤ HNDLR ◢ uplink established')
    await startPolling($)
    return 'Uplink established. Tip: unset HIDDENWARS_PASSWORD now.'
  }

  loginFlow = { step: 'email', email: String(emailArg || '').toLowerCase(), password: '', totpSession: '', error: '', prefill: String(emailArg || '').toLowerCase() }
  const opened = await $.ui.open({ id: 'hw-login', title: 'HW UPLINK', focus: true, closeOnEscape: true })
  $.ui.invalidate('ui.render')
  return opened && opened.isPlaced
    ? 'UPLINK pane open — enter your credentials there.'
    : 'Login pane is waiting — widen the terminal (144+ columns) to see it.'
}

function submitEmail($, value) {
  const v = String(value || '').trim().toLowerCase()
  if (!v || !v.includes('@')) {
    loginFlow.error = 'Enter the email your operator account is registered to.'
  } else {
    loginFlow.email = v
    loginFlow.step = 'password'
    loginFlow.error = ''
  }
  $.ui.invalidate('ui.render')
}

async function submitPassword($, value) {
  if (!value) {
    loginFlow.error = 'Password required.'
    $.ui.invalidate('ui.render')
    return
  }
  loginFlow.password = value
  loginFlow.step = 'busy'
  loginFlow.error = ''
  $.ui.invalidate('ui.render')
  try {
    const res = await client($).login(loginFlow.email, loginFlow.password)
    loginFlow.password = ''
    if (res.requires2fa) {
      loginFlow.totpSession = res.totpSession
      loginFlow.step = 'totp'
    } else {
      await finishLogin($)
      return
    }
  } catch (err) {
    loginFlow.step = 'password'
    loginFlow.error = (err && err.message) || 'Login failed.'
  }
  $.ui.invalidate('ui.render')
}

async function submitTotp($, value) {
  const code = String(value || '').replace(/\s+/g, '')
  loginFlow.step = 'busy'
  loginFlow.error = ''
  $.ui.invalidate('ui.render')
  try {
    await client($).totpLogin(loginFlow.totpSession, code)
    await finishLogin($)
  } catch (err) {
    loginFlow.step = 'totp'
    loginFlow.error = (err && err.message) || 'Verification failed.'
    $.ui.invalidate('ui.render')
  }
}

async function finishLogin($) {
  loginFlow = null
  await $.ui.close({ id: 'hw-login' })
  $.ui.toast('◤ HNDLR ◢ uplink established')
  failStreak = 0
  await startPolling($)
}

function cancelLogin($) {
  loginFlow = null
  $.ui.close({ id: 'hw-login' })
}

// ---- background uplink --------------------------------------------------------

function client($) {
  return createClient({
    base: baseCache,
    http: (url, init) => $.http.fetch(url, init),
    getTokens: async () => (await $.store.get('hw.tokens')) || null,
    setTokens: async (t) => {
      if (t) await $.store.set('hw.tokens', t)
      else await $.store.delete('hw.tokens')
    },
  })
}

function stopPolling() {
  if (pollTimer) {
    if (typeof pollTimer === 'function') pollTimer()
    else if (pollTimer.cancel) pollTimer.cancel()
    pollTimer = null
  }
}

async function startPolling($) {
  const tokens = await $.store.get('hw.tokens')
  const sec = pollSeconds(await $.store.get('hw.pollSec'))
  stopPolling()
  if (!tokens || !tokens.refresh_token || sec === 0) return false
  failStreak = 0
  pollTimer = $.clock.every(sec * 1000, () => { pollOnce($) })
  pollOnce($)
  return true
}

function pollSeconds(stored) {
  const n = Number(stored)
  if (!Number.isFinite(n)) return DEFAULT_POLL_SEC
  if (n === 0) return 0 // explicit off
  return Math.min(MAX_POLL_SEC, Math.max(MIN_POLL_SEC, Math.round(n)))
}

async function pollOnce($) {
  try {
    const c = client($)
    const [me, notif] = await Promise.all([
      c.get('/player'),
      c.get('/player/notifications?limit=25'),
    ])
    failStreak = 0
    const p = (me && me.player) || {}
    const unread = notif ? notif.unread_count : 0
    $.ui.status('◤HW ' + (p.username || 'operator') + ' · crypto ' + compact(p.crypto)
      + ' · heat ' + p.heat + ' · ' + unread + ' unread')
    await announceNew($, (notif && notif.notifications) || [])
  } catch (err) {
    if (err && err.code === 'SESSION_EXPIRED') {
      stopPolling()
      $.ui.status('◤HW uplink expired — run /hw login')
      return
    }
    failStreak += 1
    if (failStreak >= 5) {
      stopPolling()
      $.ui.status('◤HW uplink lost — run /hw to reconnect')
    }
  }
}

// Toasts alert-grade transmissions once; every id is remembered so nothing
// repeats across polls or sessions. First poll after login seeds silently.
async function announceNew($, list) {
  const seen = new Set((await $.store.get('hw.seen')) || [])
  const fresh = list.filter((n) => !seen.has(n.id))
  if (seen.size === 0) {
    for (const n of list) seen.add(n.id)
  } else {
    for (const n of fresh) {
      seen.add(n.id)
      const sev = String(n.severity || '').toLowerCase()
      if (!n.read_at && (sev === 'danger' || sev === 'warning')) {
        $.ui.toast('◤ HNDLR ◢ ' + (n.title || n.type || 'transmission'))
      }
    }
  }
  await $.store.set('hw.seen', Array.from(seen).slice(-SEEN_CAP))
}

// ---- config -------------------------------------------------------------------

async function setPoll($, arg) {
  if (arg === undefined) {
    const sec = pollSeconds(await $.store.get('hw.pollSec'))
    return 'Poll cadence: ' + (sec === 0 ? 'off' : sec + 's') + ' (min ' + MIN_POLL_SEC + 's, max ' + MAX_POLL_SEC + 's).'
  }
  if (arg.toLowerCase() === 'off') {
    await $.store.set('hw.pollSec', 0)
    stopPolling()
    $.ui.status(undefined)
    return 'Background polling off.'
  }
  const wanted = parseInt(arg, 10)
  if (!Number.isFinite(wanted) || wanted < MIN_POLL_SEC) {
    return 'Give seconds between ' + MIN_POLL_SEC + ' and ' + MAX_POLL_SEC + ', or "off".'
  }
  const sec = pollSeconds(wanted)
  await $.store.set('hw.pollSec', sec)
  await startPolling($)
  return 'Polling every ' + sec + 's.'
}

async function setApi($, arg) {
  if (arg === undefined) return 'API base: ' + baseCache + (baseCache === DEFAULT_BASE ? ' (default)' : '')
  if (arg.toLowerCase() === 'reset') {
    await $.store.delete('hw.base')
    baseCache = DEFAULT_BASE
    return 'API base reset to ' + DEFAULT_BASE
  }
  if (!/^https?:\/\//.test(arg)) return 'Give an absolute http(s) URL, or "reset".'
  baseCache = arg.replace(/\/+$/, '')
  await $.store.set('hw.base', baseCache)
  return 'API base set to ' + baseCache
}
