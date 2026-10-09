# hiddenwars — HNDLR uplink for Claude Code

> The signal was always there. You just needed a terminal that listens.

A [Claude Code mod](https://code.claude.com/docs/en/plugins/mods/overview) for
[HiddenWars](https://hiddenwars.io) operators: your account, piped straight
into the terminal you already live in. Check crypto and heat between commits,
watch the wire for incoming heat lockouts and raids — without opening the game.

## What it does

- **`/hw`** — opens the **dashboard panel** (a right sidebar in wide
  terminals, 144+ columns): resources, a heat bar with lockout threshold,
  vault protection, botnet rollup, active operations (world boss, siege,
  events), recent transmissions, and the latest Wire headlines — with
  `r` refresh / `m` read-all / `x` close controls. It auto-refreshes on the
  poll cadence.
- **`/hw status`** — the same operator readout as text.
- **`/hw notif [n]`** — latest transmissions, severity-marked, newest first.
- **`/hw read`** — clear the unread badge.
- **Status line** — once logged in, a quiet `◤HW <operator> · crypto 1.2M ·
  heat 22 · 3 unread` line lives under your prompt and refreshes itself.
- **Live toasts** — new warning/danger transmissions (heat lockouts, bounties
  posted on you, raids) surface as `◤ HNDLR ◢` toasts the moment they land.
- **`/hw login` / `/hw logout` / `/hw poll <sec|off>` / `/hw api <url>`** —
  session and background polling controls.

## Install

Requires Claude Code **v2.1.287+**.

```
claude plugin marketplace add snickers54/hndlr-uplink
claude plugin install hiddenwars@shadownet
```

Then restart Claude Code (or run `/plugin`) and type `/hw`.

## Login

Run `/hw login` — a pane opens and asks for your email, password, and auth
code if you have 2FA enabled. Fields are drawn as typed, so mind your
surroundings.

Prefer not to type the password in the pane? Put it in the environment once:

```
HIDDENWARS_PASSWORD=… claude
```

…then run `/hw login you@example.com`. The password is read once, never
written anywhere, and you'll be reminded to unset it.

## Privacy & security

- Credentials go to the HiddenWars API only (`https://api.hiddenwars.io` by
  default; check any time with `/hw api`).
- Your **password is never stored**. The mod keeps a refresh token (rotated
  by the server on every use, 30-day life) in Claude Code's per-plugin store
  under `~/.claude/plugins/store/`. `/hw logout` revokes it server-side and
  erases it locally.
- The uplink is **read-only**: it never acts in the game. The only writes are
  the login endpoints and an explicit `/hw read`. It polls at most once per
  30s (`/hw poll` to change, `/hw poll off` to stop).
- Requests identify themselves as `hiddenwars-uplink/0.1 (claude-code-mod)`.

## Development

```
claude plugin validate ./mods/hiddenwars   # static analysis
node --test mods/hiddenwars/tests/*.test.js
claude --plugin-dir ./mods/hiddenwars      # live load, hot reload
```

Layout: `hooks/register.js` (commands, pane, poller) · `hooks/api.js`
(token lifecycle, `$`-free and unit-tested) · `hooks/format.js` (pure
formatting) · `.claude-plugin/marketplace.json` at the repo root ships this
directory as the `shadownet` marketplace.

*The wire is quiet. It won't stay that way.* ◤
