// Pure builders for the HW UPLINK dashboard pane — no mods API, no network.
// register.js resolves the element constructors (Box/Text/Button) from
// $.ui.resolve(e) and passes them in, so everything here is unit-testable
// under plain node.
//
// Data comes from GET /player/state, /player/notifications, /botnet/summary
// and /wire/latest (see api.js / register.js refreshPanel).

import { compact, timeAgo } from './format.js'

// models.HeatLockoutThreshold in the backend — the heat bar's full scale.
export const HEAT_MAX = 200

const SEV_COLORS = { danger: 'red', warning: 'yellow', success: 'green', info: 'gray' }

export function heatRatio(heat, threshold) {
  const h = Number(heat) || 0
  const t = Number(threshold) || HEAT_MAX
  return Math.max(0, Math.min(1, h / t))
}

export function heatBar(heat, threshold, cells = 12) {
  const filled = Math.round(heatRatio(heat, threshold) * cells)
  return '█'.repeat(filled) + '░'.repeat(cells - filled)
}

export function heatColor(heat, threshold) {
  const r = heatRatio(heat, threshold)
  if (r >= 1) return 'red'
  if (r >= 0.5) return 'yellow'
  return 'green'
}

// buildPanel(el, data, width) -> element tree for the hw-panel pane.
//   el   { Box, Text, Button } as resolved by $.ui.resolve(e)
//   data { state, notif, botnet, wire, error, updatedAt } — any may be absent
//   width  the pane's body width in cells (for dividers/truncation)
export function buildPanel(el, data, width = 44) {
  const { Box, Text, Button } = el
  const state = data.state || {}
  const p = state.player || {}
  const lock = state.heat_lockout || {}
  const vault = state.vault || {}
  const notif = data.notif || {}
  const botnet = data.botnet
  const wireItems = (data.wire && data.wire.items) || []
  const inner = Math.max(20, Math.min(48, (width || 44) - 2))

  const children = []

  // ── header ─────────────────────────────────────────────────────────────
  children.push(Text({ bold: true, children: ['◤ HNDLR UPLINK'] }))
  const idLine = [p.username || 'operator']
  if (p.archetype) idLine.push(p.archetype)
  if (p.subscription_tier && p.subscription_tier !== 'NONE') idLine.push(p.subscription_tier)
  children.push(Text({ dimColor: true, children: [idLine.join(' · ')] }))
  children.push(divider(Text, inner))

  if (!p.username && !data.error) {
    children.push(Text({ dimColor: true, children: ['establishing uplink…'] }))
    children.push(divider(Text, inner))
  }

  // ── resources ──────────────────────────────────────────────────────────
  if (p.username) {
    children.push(sectionTitle(Text, 'RESOURCES'))
    children.push(row(el, 'crypto', compact(p.crypto) + (p.dirty_crypto ? '  +' + compact(p.dirty_crypto) + ' dirty' : '')))
    children.push(row(el, 'fragments', compact(p.fragments)))
    if (p.echoes) children.push(row(el, 'echoes', compact(p.echoes)))
    children.push(row(el, 'reputation', compact(p.reputation)))

    if (Number(vault.cap) > 0) {
      const bits = ['protected ' + compact(vault.protected) + '/' + compact(vault.cap)]
      if (Number(vault.exposed) > 0) bits.push(compact(vault.exposed) + ' exposed')
      if (vault.mining_halted) bits.push('MINING HALTED')
      children.push(row(el, 'vault', bits.join(' · '), { color: vault.mining_halted || Number(vault.exposed) > 0 ? 'yellow' : undefined }))
    }

    // heat with a bar scaled to the lockout threshold
    const heat = Number(p.heat) || 0
    children.push(Box({
      flexDirection: 'row',
      justifyContent: 'space-between',
      children: [
        Text({ dimColor: true, children: ['heat'] }),
        Box({
          flexDirection: 'row',
          columnGap: 1,
          children: [
            Text({ color: heatColor(heat, lock.threshold), children: [heat + ' ' + heatBar(heat, lock.threshold)] }),
            lock.locked ? Text({ bold: true, color: 'red', children: ['LOCKED'] }) : Text({ dimColor: true, children: ['/' + (lock.threshold || HEAT_MAX)] }),
          ],
        }),
      ],
    }))
  }

  // ── botnet ─────────────────────────────────────────────────────────────
  if (botnet) {
    children.push(divider(Text, inner))
    children.push(sectionTitle(Text, 'BOTNET'))
    children.push(row(el, 'nodes', botnet.total_nodes + ' · health ' + Math.round(botnet.aggregate_health || 0) + '%'))
    const trouble = []
    if (botnet.critical_count) trouble.push(botnet.critical_count + ' critical')
    if (botnet.offline_count) trouble.push(botnet.offline_count + ' offline')
    if (trouble.length) children.push(row(el, 'status', trouble.join(' · '), { color: 'red' }))
  }

  // ── active operations ──────────────────────────────────────────────────
  const ops = activeOps(state)
  if (ops.length) {
    children.push(divider(Text, inner))
    children.push(sectionTitle(Text, 'OPERATIONS'))
    for (const op of ops) {
      children.push(Text({ color: 'magenta', children: ['▲ ' + op] }))
    }
  }

  // ── transmissions ──────────────────────────────────────────────────────
  if (p.username) {
    children.push(divider(Text, inner))
    const unread = notif.unread_count || 0
    children.push(sectionTitle(Text, 'TRANSMISSIONS' + (unread ? ' · ' + unread + ' unread' : '')))
    const list = notif.notifications || []
    if (!list.length) {
      children.push(Text({ dimColor: true, children: ['the wire is quiet'] }))
    } else {
      for (const n of list.slice(0, 6)) {
        const unreadMark = n.read_at ? ' ' : '● '
        children.push(Box({
          flexDirection: 'row',
          justifyContent: 'space-between',
          children: [
            Text({
              bold: !n.read_at,
              color: SEV_COLORS[String(n.severity || '').toLowerCase()] || 'gray',
              wrap: 'truncate-end',
              children: [unreadMark + (n.title || n.type || 'transmission')],
            }),
            Text({ dimColor: true, children: [timeAgo(n.created_at)] }),
          ],
        }))
      }
    }
  }

  // ── the wire ───────────────────────────────────────────────────────────
  if (wireItems.length) {
    children.push(divider(Text, inner))
    children.push(sectionTitle(Text, 'THE WIRE'))
    for (const item of wireItems.slice(0, 4)) {
      children.push(Box({
        flexDirection: 'row',
        justifyContent: 'space-between',
        children: [
          Text({ wrap: 'truncate-end', color: item.pinned ? 'cyan' : undefined, children: ['► ' + (item.headline || item.body || '')] }),
          Text({ dimColor: true, children: [timeAgo(item.occurredAt)] }),
        ],
      }))
    }
  }

  // ── footer: freshness, error, controls ─────────────────────────────────
  children.push(divider(Text, inner))
  if (data.error) {
    children.push(Text({ color: 'red', children: [data.error] }))
  } else if (data.updatedAt) {
    children.push(Text({ dimColor: true, children: ['updated ' + clock(data.updatedAt)] }))
  }
  children.push(Box({
    flexDirection: 'row',
    columnGap: 2,
    children: [
      Button({ key: 'hw-panel-refresh', label: 'refresh', hotkey: 'r', plain: true, dimColor: true, onPress: data.onRefresh || noop }),
      Button({ key: 'hw-panel-read', label: 'read all', hotkey: 'm', plain: true, dimColor: true, onPress: data.onReadAll || noop }),
      Button({ key: 'hw-panel-close', label: 'close', hotkey: 'x', plain: true, dimColor: true, onPress: data.onClose || noop }),
    ],
  }))

  return Box({ flexDirection: 'column', children })
}

// Everything active right now that an operator should glance at. Shapes are
// defensive: /player/state may add fields; presence is what matters here.
export function activeOps(state) {
  const ops = []
  const boss = state.active_world_boss
  if (boss) ops.push('WORLD BOSS — ' + (boss.name || boss.title || 'ACTIVE'))
  if (state.siege_season) ops.push('SIEGE SEASON — ' + (state.siege_season.name || state.siege_season.season_name || 'DESCENT OPEN'))
  const event = state.active_event
  if (event) ops.push('EVENT — ' + (event.name || event.title || 'LIVE'))
  return ops
}

function sectionTitle(Text, label) {
  return Text({ bold: true, dimColor: true, children: [label] })
}

function divider(Text, width) {
  return Text({ dimColor: true, children: ['─'.repeat(width)] })
}

function row(el, label, value, valueProps = {}) {
  const { Box, Text } = el
  return Box({
    flexDirection: 'row',
    justifyContent: 'space-between',
    children: [
      Text({ dimColor: true, children: [label] }),
      Text({ ...valueProps, children: [String(value)] }),
    ],
  })
}

function clock(ts) {
  const d = new Date(ts)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return hh + ':' + mm
}

function noop() {}
