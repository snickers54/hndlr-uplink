// Pure builders for the HW UPLINK dashboard pane — no mods API, no network.
// register.js resolves the element constructors (Box/Text/Button) from
// $.ui.resolve(e) and passes them in, so everything here is unit-testable
// under plain node.
//
// Data comes from GET /player/state, /player/notifications, /botnet/summary
// and /wire/latest (see api.js / register.js refreshPanel).
//
// Layout uses the Ink-style props the pane surface exposes (borderStyle,
// padding, flexGrow, justifyContent…): a solid inverse title bar, one round
// bordered card carrying every number (stat grid, vault, heat gauge, botnet
// rollup), then chip-headed list sections, then a one-line footer.

import { compact, timeAgo } from './format.js'

// models.HeatLockoutThreshold in the backend — the heat bar's full scale.
export const HEAT_MAX = 200

const SEV_COLORS = { danger: 'red', warning: 'yellow', success: 'green', info: 'gray' }
const STAT_COLORS = { crypto: 'cyan', fragments: 'magenta', echoes: 'blue', reputation: 'green' }

export function heatRatio(heat, threshold) {
  const h = Number(heat) || 0
  const t = Number(threshold) || HEAT_MAX
  return Math.max(0, Math.min(1, h / t))
}

export function heatBar(heat, threshold, cells = 14) {
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
//   width  the pane's body width in cells (for the title bar / headers)
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

  // ── title bar: inverse strip, status right-aligned ──────────────────────
  const online = !!(p.username || data.updatedAt)
  const right = data.error
    ? 'NO LINK'
    : online ? 'LIVE ' + clock(data.updatedAt || Date.now()) : 'STANDBY'
  const title = '◤ HNDLR UPLINK'
  const gap = Math.max(1, inner - title.length - right.length)
  children.push(Text({
    inverse: true,
    bold: true,
    color: data.error ? 'red' : undefined,
    children: [title + ' '.repeat(gap) + right],
  }))

  // ── identity ────────────────────────────────────────────────────────────
  if (p.username) {
    const tier = String(p.subscription_tier || '').toUpperCase()
    const meta = [p.archetype, tier && tier !== 'NONE' && tier !== 'FREE' ? tier : '']
      .filter(Boolean).join(' · ')
    children.push(Box({
      flexDirection: 'row',
      columnGap: 1,
      children: [
        Text({ bold: true, children: [p.username] }),
        meta ? Text({ dimColor: true, children: [meta] }) : null,
      ].filter(Boolean),
    }))
  }

  // ── the numbers card ────────────────────────────────────────────────────
  if (p.username) {
    const card = []

    const stats = [
      ['crypto', compact(p.crypto) + (p.dirty_crypto ? ' +' + compact(p.dirty_crypto) : '')],
      ['fragments', compact(p.fragments)],
    ]
    if (p.echoes) stats.push(['echoes', compact(p.echoes)])
    stats.push(['reputation', compact(p.reputation)])
    for (let i = 0; i < stats.length; i += 2) {
      card.push(Box({
        flexDirection: 'row',
        columnGap: 1,
        marginTop: 1,
        children: stats.slice(i, i + 2).map(([label, value]) => statCell(el, label, value)),
      }))
    }

    if (Number(vault.cap) > 0) {
      const bits = ['protected ' + compact(vault.protected) + '/' + compact(vault.cap)]
      if (Number(vault.exposed) > 0) bits.push(compact(vault.exposed) + ' exposed')
      if (vault.mining_halted) bits.push('MINING HALTED')
      const warn = vault.mining_halted || Number(vault.exposed) > 0
      card.push(Box({
        flexDirection: 'row',
        columnGap: 1,
        marginTop: 1,
        children: [
          Text({ dimColor: true, children: ['VAULT'] }),
          Text({ color: warn ? 'yellow' : undefined, children: [bits.join(' · ')] }),
        ],
      }))
    }

    const heat = Number(p.heat) || 0
    card.push(Box({
      flexDirection: 'row',
      columnGap: 1,
      marginTop: 1,
      children: [
        Text({ dimColor: true, children: ['HEAT'] }),
        Text({ color: heatColor(heat, lock.threshold), children: [heatBar(heat, lock.threshold)] }),
        Text({ dimColor: true, children: [heat + '/' + (lock.threshold || HEAT_MAX)] }),
      ].concat(lock.locked ? [Text({ inverse: true, bold: true, color: 'red', children: [' LOCKED '] })] : []),
    }))

    if (botnet) {
      card.push(Box({
        flexDirection: 'row',
        columnGap: 1,
        marginTop: 1,
        children: [
          Text({ dimColor: true, children: ['BOTNET'] }),
          Text({ children: [botnet.total_nodes + ' nodes · ' + Math.round(botnet.aggregate_health || 0) + '%'] }),
        ],
      }))
      const trouble = []
      if (botnet.critical_count) trouble.push(botnet.critical_count + ' critical')
      if (botnet.offline_count) trouble.push(botnet.offline_count + ' offline')
      if (trouble.length) {
        card.push(Text({ color: 'red', children: ['! ' + trouble.join(' · ')] }))
      }
    }

    children.push(Box({
      borderStyle: 'round',
      borderDimColor: true,
      flexDirection: 'column',
      marginTop: 1,
      paddingX: 1,
      children: card,
    }))
  } else if (!data.error) {
    children.push(Box({
      borderStyle: 'round',
      borderDimColor: true,
      marginTop: 1,
      paddingX: 1,
      children: [Text({ dimColor: true, children: ['establishing uplink…'] })],
    }))
  }

  // ── active operations ───────────────────────────────────────────────────
  const ops = activeOps(state)
  if (ops.length) {
    children.push(sectionHeader(el, 'OPERATIONS', inner))
    for (const op of ops) {
      children.push(Text({ color: 'magenta', children: ['▲ ' + op] }))
    }
  }

  // ── transmissions ───────────────────────────────────────────────────────
  if (p.username) {
    const unread = notif.unread_count || 0
    children.push(sectionHeader(el, 'TRANSMISSIONS', inner, unread ? { text: unread + ' unread', color: 'yellow' } : null))
    const list = notif.notifications || []
    if (!list.length) {
      children.push(Text({ dimColor: true, children: ['the wire is quiet'] }))
    } else {
      for (const n of list.slice(0, 6)) {
        children.push(Box({
          flexDirection: 'row',
          justifyContent: 'space-between',
          columnGap: 1,
          children: [
            Text({
              bold: !n.read_at,
              dimColor: !!n.read_at,
              color: SEV_COLORS[String(n.severity || '').toLowerCase()] || 'gray',
              wrap: 'truncate-end',
              children: [(n.read_at ? '  ' : '› ') + (n.title || n.type || 'transmission')],
            }),
            Text({ dimColor: true, children: [timeAgo(n.created_at)] }),
          ],
        }))
      }
    }
  }

  // ── the wire ────────────────────────────────────────────────────────────
  if (wireItems.length) {
    children.push(sectionHeader(el, 'THE WIRE', inner))
    for (const item of wireItems.slice(0, 4)) {
      children.push(Box({
        flexDirection: 'row',
        justifyContent: 'space-between',
        columnGap: 1,
        children: [
          Text({ wrap: 'truncate-end', color: item.pinned ? 'cyan' : undefined, children: ['► ' + (item.headline || item.body || '')] }),
          Text({ dimColor: true, children: [timeAgo(item.occurredAt)] }),
        ],
      }))
    }
  }

  // ── footer: freshness/error left, controls right ────────────────────────
  children.push(Box({
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 1,
    children: [
      data.error
        ? Text({ color: 'red', children: [data.error] })
        : Text({ dimColor: true, children: [data.updatedAt ? 'updated ' + clock(data.updatedAt) : ''] }),
      Box({
        flexDirection: 'row',
        columnGap: 2,
        children: [
          Button({ key: 'hw-panel-refresh', label: 'refresh', hotkey: 'r', plain: true, dimColor: true, onPress: data.onRefresh || noop }),
          Button({ key: 'hw-panel-read', label: 'read all', hotkey: 'm', plain: true, dimColor: true, onPress: data.onReadAll || noop }),
          Button({ key: 'hw-panel-close', label: 'close', hotkey: 'x', plain: true, dimColor: true, onPress: data.onClose || noop }),
        ],
      }),
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

// A label-over-value cell; flexGrow makes pairs split the card's width.
function statCell(el, label, value) {
  const { Box, Text } = el
  return Box({
    flexGrow: 1,
    flexDirection: 'column',
    children: [
      Text({ dimColor: true, children: [label.toUpperCase()] }),
      Text({ bold: true, color: STAT_COLORS[label], children: [value] }),
    ],
  })
}

// ─ TRANSMISSIONS · 3 unread ─────────── with an optional highlighted badge.
function sectionHeader(el, label, width, badge = null) {
  const { Box, Text } = el
  const lead = '─ ' + label
  const badgeText = badge ? ' · ' + badge.text : ''
  const tailLen = Math.max(1, width - (lead.length + badgeText.length + 1))
  return Box({
    flexDirection: 'row',
    marginTop: 1,
    children: [
      Text({ dimColor: true, bold: true, children: [lead] }),
      badge ? Text({ bold: true, color: badge.color || 'yellow', children: [badgeText] }) : null,
      Text({ dimColor: true, children: [' ' + '─'.repeat(tailLen)] }),
    ].filter(Boolean),
  })
}

function clock(ts) {
  const d = new Date(ts)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return hh + ':' + mm
}

function noop() {}
