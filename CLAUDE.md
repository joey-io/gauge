# burn — Claude Code usage meter

The build-candidate from radar's 2026-08-02 brief: "I pay for an AI plan and can't
tell which tasks burn my quota." burn reads the transcripts Claude Code already
writes (`~/.claude/projects/**/*.jsonl`), dedupes to real API messages, and shows
where the allowance goes — by 5-hour window, day, model, and project.

Zero npm dependencies: `node:sqlite` (node ≥ 22.5), same pattern as radar.

## Commands

| Command | What |
|---|---|
| `burn` (alias) | One-screen dashboard: last-5h window vs observed peak, 14-day daily bars, by-model, by-project |
| `node bin/burn.mjs [--days N]` | Same; `--days` widens the breakdown sections (default 7) |

## How it measures

- Dollars are **API-list-equivalent** (rates in `lib/pricing.mjs`), not a bill —
  plans don't publish quota mechanics, so API-$ is the only honest common currency.
  Cache reads bill at 0.1× input, cache writes at 1.25× (5m) / 2× (1h).
- **Dedupe matters:** Claude Code writes one jsonl line per streamed chunk, all
  carrying the same `message.id` and usage; resumed sessions replay messages into
  new files. `events` is keyed on message id with INSERT OR REPLACE (last write
  wins, which is the final usage). Naive line-summing over-counts wildly.
- Subagent transcripts nest 2–3 directories deep under the session dir — the
  scanner walks recursively. Missing them hides ~half the spend.
- "Peak 5h window" is the **observed** ceiling (max sliding 5-hour spend ever),
  labeled as such — it is not the plan limit, which Anthropic doesn't expose.
- Incremental: `files` table keys on path+mtime+size; unchanged files are skipped.
  Full first scan ~60s over 785MB; steady-state runs ~1–2s.

## Layout

- `bin/burn.mjs` — scan + render, all display logic
- `lib/scan.mjs` — incremental jsonl ingest (recursive walk, dedupe rules)
- `lib/pricing.mjs` — price table + cost(); update here when Anthropic reprices
- `lib/db.mjs` — schema (`files`, `events`)
- `data/burn.db` — sqlite; gitignored

## Rules

- No LLM calls, no network — purely mechanical over local files.
- Never present API-$ as "what you owe"; always label as API-equivalent.
- Timestamps UTC (box timezone).
