# gauge

A local meter for your AI coding plans. You pay a flat monthly price; gauge
shows you where it goes — by 5-hour window, day, model, and project.

```
npx github:joey-io/gauge
```

That's the whole install. It reads the session transcripts Claude Code already
writes to `~/.claude/projects` (and, if you use Codex, the rollouts in
`~/.codex/sessions`), dedupes them down to real API messages, and renders one
screen:

- your last 5 hours of spend against the biggest 5-hour window you've ever had
- daily bars for the last 14 days
- which models and which projects are eating the allowance
- a separate codex section when Codex rollouts exist — it's a separate plan's
  quota, so it never mixes into the Claude numbers

Nothing leaves your machine. No account, no telemetry, no network calls.

## Statusline

`gauge statusline` prints one line made for Claude Code's statusLine slot —
measured burn beside the official plan percentages Claude Code pipes in:

```
5h $42.3 · 18% of peak · 7d $915 · top a-gnt · plan 5h 18% wk 43%
```

Install gauge on your PATH (`npm i -g github:joey-io/gauge`), then in
`~/.claude/settings.json`:

```json
{ "statusLine": { "type": "command", "command": "gauge statusline" } }
```

It rescans at most once a minute, so statusline refreshes stay fast.

## How it counts

- Dollars are **API-list-equivalent** — what this usage would cost at the
  vendor's published API rates. Subscription plans don't publish their quota
  mechanics, so this is the only honest common currency. It is not your bill.
- Claude Code writes one transcript line per streamed chunk, all carrying the
  same message id, and replays messages into new files when sessions resume.
  gauge dedupes by message id; naive line-summing over-counts badly.
- Subagent transcripts nest several directories deep. gauge walks them —
  in testing they held roughly half the spend.
- Codex rollouts log per-turn token deltas rather than per-message usage;
  gauge keys them so a forked or replayed session can't double-count. A model
  with no known list rate shows token counts, never invented dollars — add the
  rate in `lib/pricing.mjs` when the vendor publishes it.
- "Peak 5h window" is your observed ceiling, labeled as such. Vendors don't
  expose the actual plan limits.

## Requirements

Node 22.5 or newer (uses the built-in sqlite — zero npm dependencies).
A Claude Code history at `~/.claude/projects`, a Codex history at
`~/.codex`, or both.

## Options

```
gauge --days 30       # widen the by-model / by-project sections
gauge statusline      # one line for Claude Code's statusLine slot
gauge activate <key>  # register a license key (verifies offline)
GAUGE_DATA_DIR=...    # move the cache db (default ~/.cache/gauge)
CODEX_HOME=...        # where Codex rollouts live (default ~/.codex)
```

The first run scans your full history (about a minute per GB of transcripts).
After that it's incremental and takes a second or two.

## License

MIT.
