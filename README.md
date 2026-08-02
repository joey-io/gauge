# gauge

A local meter for your Claude Code plan. You pay a flat monthly price; gauge
shows you where it goes — by 5-hour window, day, model, and project.

```
npx github:joey-io/gauge
```

That's the whole install. It reads the session transcripts Claude Code already
writes to `~/.claude/projects`, dedupes them down to real API messages, and
renders one screen:

- your last 5 hours of spend against the biggest 5-hour window you've ever had
- daily bars for the last 14 days
- which models and which projects are eating the allowance

Nothing leaves your machine. No account, no telemetry, no network calls.

## How it counts

- Dollars are **API-list-equivalent** — what this usage would cost at
  Anthropic's published API rates. Subscription plans don't publish their quota
  mechanics, so this is the only honest common currency. It is not your bill.
- Claude Code writes one transcript line per streamed chunk, all carrying the
  same message id, and replays messages into new files when sessions resume.
  gauge dedupes by message id; naive line-summing over-counts badly.
- Subagent transcripts nest several directories deep. gauge walks them —
  in testing they held roughly half the spend.
- "Peak 5h window" is your observed ceiling, labeled as such. Anthropic doesn't
  expose the actual plan limit.

## Requirements

Node 22.5 or newer (uses the built-in sqlite — zero npm dependencies).
A Claude Code history at `~/.claude/projects`.

## Options

```
gauge --days 30       # widen the by-model / by-project sections
gauge activate <key>  # register a license key (verifies offline)
GAUGE_DATA_DIR=...    # move the cache db (default ~/.cache/gauge)
```

The first run scans your full history (about a minute per GB of transcripts).
After that it's incremental and takes a second or two.

## License

MIT.
