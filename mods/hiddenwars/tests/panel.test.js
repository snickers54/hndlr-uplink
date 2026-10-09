import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildPanel, heatRatio, heatBar, heatColor, activeOps, humanizeMentions, HEAT_MAX } from '../hooks/panel.js'

// Fake element constructors — buildPanel only passes props through, so plain
// object tags let tests walk the tree like the surface renderer would.
const Box = (props) => ({ kind: 'Box', ...props })
const Text = (props) => ({ kind: 'Text', ...props })
const Button = (props) => ({ kind: 'Button', ...props })
const el = { Box, Text, Button }

const baseData = {
  state: {
    player: {
      username: 'S4B3R', archetype: 'STEALTH', subscription_tier: 'GHOST',
      crypto: 12432100, dirty_crypto: 340, fragments: 1204, echoes: 56,
      reputation: 5210, heat: 22,
    },
    heat_lockout: { threshold: 200, locked: false },
    vault: { cap: 10000000, protected: 8100000, exposed: 0, mining_halted: false },
  },
  notif: {
    unread_count: 1,
    notifications: [
      { id: 'n1', severity: 'danger', title: 'Heat lockout started', read_at: null, created_at: new Date(Date.now() - 60_000).toISOString() },
      { id: 'n2', severity: 'info', title: 'Raid repelled', read_at: '2026-10-09T00:00:00Z', created_at: new Date(Date.now() - 3600_000).toISOString() },
    ],
  },
  botnet: { total_nodes: 48, aggregate_health: 81, critical_count: 3, offline_count: 2 },
  wire: { items: [
    { id: 'w1', headline: 'NEXUS breach contained, says CORP', occurredAt: new Date(Date.now() - 7200_000).toISOString(), pinned: true },
    { id: 'w2', headline: 'DarkNet chatter spikes in sector 7', occurredAt: new Date(Date.now() - 300_000).toISOString() },
  ] },
  updatedAt: Date.parse('2026-10-09T12:03:00Z'),
}

function texts(tree, out = []) {
  if (!tree || typeof tree !== 'object') return out
  if (tree.kind === 'Text') out.push(tree)
  for (const c of tree.children || []) texts(c, out)
  return out
}
function boxes(tree, out = []) {
  if (!tree || typeof tree !== 'object') return out
  if (tree.kind === 'Box') out.push(tree)
  for (const c of tree.children || []) boxes(c, out)
  return out
}
const allText = (data) => texts(buildPanel(el, data)).map((t) => (t.children || []).join(''))
const allTextNodes = (data) => texts(buildPanel(el, data))

test('heat helpers scale against the lockout threshold', () => {
  assert.equal(HEAT_MAX, 200)
  assert.equal(heatRatio(100, 200), 0.5)
  assert.equal(heatRatio(400, 200), 1) // clamped, never over
  assert.equal(heatRatio(undefined, undefined), 0)
  assert.equal(heatBar(100, 200, 10), '█████░░░░░')
  assert.equal(heatBar(0, 200, 4), '░░░░')
  assert.equal(heatColor(50, 200), 'green')
  assert.equal(heatColor(120, 200), 'yellow')
  assert.equal(heatColor(200, 200), 'red')
})

test('title bar: inverse strip with LIVE clock, NO LINK when erroring', () => {
  const live = allTextNodes(baseData)[0]
  assert.equal(live.inverse, true)
  assert.equal(live.bold, true)
  assert.ok((live.children || [])[0].includes('◤ HNDLR UPLINK'))
  assert.ok((live.children || [])[0].includes('LIVE'))

  const down = allTextNodes({ ...baseData, error: 'Session expired — /hw login' })[0]
  assert.equal(down.color, 'red')
  assert.ok((down.children || [])[0].includes('NO LINK'))
})

test('identity line: bold operator, dim archetype and tier', () => {
  const nodes = allTextNodes(baseData)
  const name = nodes.find((t) => (t.children || [])[0] === 'S4B3R')
  assert.ok(name, 'username text missing')
  assert.equal(name.bold, true)
  const meta = nodes.find((t) => (t.children || [])[0] === 'STEALTH · GHOST')
  assert.ok(meta, 'identity meta missing')
  assert.equal(meta.dimColor, true)
})

test('stat grid: uppercase dim labels over bold colored values', () => {
  const nodes = allTextNodes(baseData)
  const cryptoLabel = nodes.find((t) => (t.children || [])[0] === 'CRYPTO')
  const cryptoValue = nodes.find((t) => (t.children || [])[0] === '12.4M +340')
  assert.ok(cryptoLabel && cryptoLabel.dimColor, 'CRYPTO label missing')
  assert.ok(cryptoValue, 'crypto value (with dirty suffix) missing')
  assert.equal(cryptoValue.bold, true)
  assert.equal(cryptoValue.color, 'cyan')
  assert.ok(nodes.some((t) => (t.children || [])[0] === 'FRAGMENTS'))
  assert.ok(nodes.some((t) => (t.children || [])[0] === 'ECHOES'), 'echoes shown when > 0')

  const noEcho = allTextNodes({ ...baseData, state: { ...baseData.state, player: { ...baseData.state.player, echoes: 0 } } })
  assert.ok(!noEcho.some((t) => (t.children || [])[0] === 'ECHOES'), 'echoes hidden at 0')
})

test('numbers live in exactly one round-bordered card', () => {
  const card = boxes(buildPanel(el, baseData)).filter((b) => b.borderStyle === 'round')
  assert.equal(card.length, 1)
  assert.equal(card[0].borderDimColor, true)
  assert.equal(card[0].paddingX, 1)
})

test('vault row: plain when safe, yellow when exposed or halted', () => {
  const safe = allTextNodes(baseData).find((t) => (t.children || [])[0] === 'protected 8.1M/10M')
  assert.ok(safe, 'vault readout missing')
  assert.notEqual(safe.color, 'yellow')

  const warn = allTextNodes({ ...baseData, state: { ...baseData.state, vault: { cap: 1000, protected: 100, exposed: 400, mining_halted: true } } })
  const text = warn.find((t) => (t.children || [])[0].includes('MINING HALTED'))
  assert.ok(text, 'halted marker missing')
  assert.equal(text.color, 'yellow')
})

test('heat gauge row: colored bar, ratio, inverse LOCKED badge', () => {
  const cool = allTextNodes(baseData)
  const bar = cool.find((t) => /^█+░+$/.test((t.children || [])[0]))
  assert.ok(bar, 'heat bar missing')
  assert.equal(bar.color, 'green')
  assert.ok(cool.some((t) => (t.children || [])[0] === '22/200'), 'ratio missing')

  const locked = allTextNodes({ ...baseData, state: { ...baseData.state, player: { ...baseData.state.player, heat: 200 }, heat_lockout: { threshold: 200, locked: true } } })
  const badge = locked.find((t) => (t.children || [])[0] === ' LOCKED ')
  assert.ok(badge, 'LOCKED badge missing')
  assert.equal(badge.inverse, true)
  assert.equal(badge.color, 'red')
  assert.equal(badge.bold, true)
})

test('botnet rollup inside the card, trouble in red', () => {
  const nodes = allTextNodes(baseData)
  assert.ok(nodes.some((t) => (t.children || [])[0] === '48 nodes · 81%'), 'botnet rollup missing')
  const trouble = nodes.find((t) => (t.children || [])[0].startsWith('! '))
  assert.ok(trouble, 'trouble line missing')
  assert.equal(trouble.color, 'red')
})

test('idle panel shows a bordered establishing-uplink card', () => {
  const lines = allText({})
  assert.ok(lines.some((l) => l.includes('establishing uplink')), 'empty state missing')
  assert.ok(lines.some((l) => l.includes('STANDBY')), 'idle bar reads STANDBY')
  assert.ok(lines.every((l) => !l.includes('LIVE ')), 'no LIVE bar without data')
  const card = boxes(buildPanel(el, {})).filter((b) => b.borderStyle === 'round')
  assert.equal(card.length, 1)
})

test('transmissions: unread bold colored with ›, read dim; header badge counts unread', () => {
  const nodes = allTextNodes(baseData)
  const unread = nodes.find((t) => (t.children || [])[0] === '› Heat lockout started')
  assert.ok(unread, 'unread transmission missing')
  assert.equal(unread.bold, true)
  assert.equal(unread.color, 'red')
  const read = nodes.find((t) => (t.children || [])[0] === '  Raid repelled')
  assert.ok(read, 'read transmission missing')
  assert.equal(read.dimColor, true)
  const badge = nodes.find((t) => (t.children || [])[0] === ' · 1 unread')
  assert.ok(badge, 'unread badge missing')
  assert.equal(badge.color, 'yellow')
})

test('quiet transmissions section says so', () => {
  const lines = allText({ ...baseData, notif: { unread_count: 0, notifications: [] } })
  assert.ok(lines.some((l) => l === 'the wire is quiet'))
})

test('the wire: pinned story in cyan, others plain', () => {
  const nodes = allTextNodes(baseData)
  const pinned = nodes.find((t) => (t.children || [])[0].startsWith('► NEXUS'))
  assert.ok(pinned, 'pinned wire item missing')
  assert.equal(pinned.color, 'cyan')
  const plain = nodes.find((t) => (t.children || [''])[0].startsWith('► DarkNet'))
  assert.ok(plain)
  assert.notEqual(plain.color, 'cyan')
})

test('wire mention tokens render as handles, never raw uuids', () => {
  const uuid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
  const data = {
    ...baseData,
    wire: { items: [
      { id: 'w1', headline: `A new operator surfaced. The handle is @[${uuid}].`, occurredAt: new Date().toISOString(), mention_names: { [uuid]: 'S4B3R' } },
      { id: 'w2', headline: `@[${uuid}] collected a 90,000 crypto bounty.`, occurredAt: new Date().toISOString() },
    ] },
  }
  const lines = allText(data)
  assert.ok(lines.some((l) => l.includes('@S4B3R')), 'resolved handle missing')
  assert.ok(lines.some((l) => l.includes('@unknown')), 'unresolved mention must read @unknown')
  assert.ok(lines.every((l) => !l.includes('@[')), 'raw mention token leaked: ' + lines.join(' | '))
  assert.equal(humanizeMentions(`@[${uuid}]`, { [uuid]: 'S4B3R' }), '@S4B3R')
  assert.equal(humanizeMentions(`@[${uuid}]`, undefined), '@unknown')
  assert.equal(humanizeMentions('no tokens here', {}), 'no tokens here')
})

test('footer: hotkey buttons r/m/x, freshness left, error replaces it', () => {
  const tree = buildPanel(el, baseData)
  const buttons = []
  ;(function walk(node) {
    if (!node || typeof node !== 'object') return
    if (node.kind === 'Button') buttons.push(node)
    for (const c of node.children || []) walk(c)
  })(tree)
  const hotkeys = buttons.map((b) => b.hotkey)
  assert.deepEqual(hotkeys.sort(), ['m', 'r', 'x'])
  assert.ok(allText(baseData).some((l) => l.startsWith('updated ')), 'updated stamp missing')

  const err = allText({ ...baseData, error: 'Session expired — /hw login' })
  assert.ok(err.includes('Session expired — /hw login'), 'error line missing')
})

test('sections render only with content; ops named defensively', () => {
  assert.deepEqual(activeOps({}), [])
  assert.deepEqual(
    activeOps({ active_world_boss: {}, siege_season: {}, active_event: {} }),
    ['WORLD BOSS — ACTIVE', 'SIEGE SEASON — DESCENT OPEN', 'EVENT — LIVE'],
  )
  assert.deepEqual(
    activeOps({ active_world_boss: { name: 'LEVIATHAN' }, siege_season: { name: 'DESCENT' }, active_event: { title: 'BLACKOUT' } }),
    ['WORLD BOSS — LEVIATHAN', 'SIEGE SEASON — DESCENT', 'EVENT — BLACKOUT'],
  )
  const withOps = { ...baseData, state: { ...baseData.state, active_world_boss: { name: 'LEVIATHAN' } } }
  assert.ok(allText(withOps).some((l) => l.includes('OPERATIONS')), 'ops header missing')
  assert.ok(!allText(baseData).some((l) => l.includes('OPERATIONS')), 'ops section should hide without ops')
})
