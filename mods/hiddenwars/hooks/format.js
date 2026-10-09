// Pure output helpers for the HNDLR uplink mod — no mods API, no network.

// 1234567 -> "1.2M", 999 -> "999", 1250 -> "1.3k", undefined -> "0".
export function compact(n) {
  const v = Number(n)
  if (!Number.isFinite(v)) return '0'
  const abs = Math.abs(v)
  const sign = v < 0 ? '-' : ''
  if (abs >= 1e9) return sign + trim(abs / 1e9) + 'B'
  if (abs >= 1e6) return sign + trim(abs / 1e6) + 'M'
  if (abs >= 1e3) return sign + trim(abs / 1e3) + 'k'
  return sign + String(Math.round(abs))
}

function trim(x) {
  const s = x >= 100 ? String(Math.round(x)) : x.toFixed(1)
  return s.replace(/\.0$/, '')
}

// ISO timestamp -> "3m ago" / "5h ago" / "2d ago"; falls back to the raw
// string when the date can't be parsed.
export function timeAgo(iso, now = Date.now()) {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return String(iso || '')
  const sec = Math.max(0, Math.floor((now - t) / 1000))
  if (sec < 60) return sec + 's ago'
  if (sec < 3600) return Math.floor(sec / 60) + 'm ago'
  if (sec < 86400) return Math.floor(sec / 3600) + 'h ago'
  return Math.floor(sec / 86400) + 'd ago'
}

// Severity -> a short terminal marker. Game severities: info, success,
// warning, danger.
export function severityMark(sev) {
  switch (String(sev || '').toLowerCase()) {
    case 'danger': return '[!!]'
    case 'warning': return '[! ]'
    case 'success': return '[ +]'
    default: return '[ i]'
  }
}

// Right-pad a label so value columns line up in command output.
export function row(label, value, width = 14) {
  return '  ' + String(label).padEnd(width) + String(value)
}
