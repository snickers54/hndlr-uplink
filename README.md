# hndlr-uplink

> The signal was always there. You just needed a terminal that listens.

The **HNDLR uplink** is a [Claude Code mod](https://code.claude.com/docs/en/plugins/mods/overview)
for operators of [HiddenWars](https://hiddenwars.io) — your account, piped
into the terminal you already work in. Check crypto and heat between commits.
Watch the wire for heat lockouts, bounties, raids. Never open the game just
to see what changed.

## Install

Requires Claude Code **v2.1.287+**.

```
claude plugin marketplace add snickers54/hndlr-uplink
claude plugin install hiddenwars@shadownet
```

Then type `/hw`.

## Quickstart

1. `/hw login` — opens a pane and asks for your HiddenWars email, password,
   and auth code if you have 2FA. (Or run `/hw login you@example.com` with
   `HIDDENWARS_PASSWORD` in the environment.)
2. A quiet line appears under your prompt — `◤HW <operator> · crypto 12.4M ·
   heat 22 · 3 unread` — and new warning/danger transmissions surface as
   `◤ HNDLR ◢` toasts as they land.
3. `/hw` for the full readout · `/hw notif` to read transmissions · `/hw read`
   to clear the badge · `/hw poll off` when you want silence.

No account yet? The wire finds everyone eventually:
[hiddenwars.io](https://hiddenwars.io).

## Notes

- Read-only: the uplink can never act in the game — it only reads your state
  (plus an explicit `/hw read`).
- Your password is never stored. A rotating 30-day refresh token lives in
  Claude Code's own plugin storage; `/hw logout` revokes it server-side and
  erases it locally.
- Requests identify as `hiddenwars-uplink/0.1 (claude-code-mod)`.

This repository is the `shadownet` plugin marketplace — it contains only the
mod. The game itself lives at [hiddenwars.io](https://hiddenwars.io).

*Stay quiet. Stay current.* ◤
