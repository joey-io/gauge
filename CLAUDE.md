# burn — AI plan usage meter (public name: gauge)

The build-candidate from radar's 2026-08-02 brief: "I pay for an AI plan and can't
tell which tasks burn my quota." burn reads the transcripts Claude Code already
writes (`~/.claude/projects/**/*.jsonl`) — and Codex rollouts
(`$CODEX_HOME/sessions/**/rollout-*.jsonl`) when present — dedupes to real API
messages, and shows where the allowance goes — by 5-hour window, day, model,
and project.

Zero npm dependencies: `node:sqlite` (node ≥ 22.5), same pattern as radar.

## Commands

| Command | What |
|---|---|
| `burn` (alias) | One-screen dashboard: last-5h window vs observed peak, 14-day daily bars, by-model, by-project, codex section when rollouts exist |
| `node bin/burn.mjs [--days N]` | Same; `--days` widens the breakdown sections (default 7) |
| `node bin/burn.mjs statusline` | One line for Claude Code's statusLine slot: measured $ + official plan % from the stdin payload; rescan throttled to 60s via `scan-marker` |

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
- **Codex rollouts** (`source='codex'` in events): token_count event lines carry a
  per-turn delta (`last_token_usage`) beside the session-cumulative total; the
  dedupe id is timestamp + both totals so forked/replayed rollouts collapse.
  Model + cwd come from the nearest preceding turn_context line. `cached_input`
  is a subset of `input_tokens`; cache writes land in the `cache_5m` column and
  price at 0 for OpenAI. Unknown models (`rate()` → null) render as token
  counts, never dollars — plan-window math stays `WHERE source='claude'`.

## Layout

- `bin/burn.mjs` — subcommand routing (dashboard / statusline / activate) + dashboard render
- `lib/scan.mjs` — incremental Claude transcript ingest (recursive walk, dedupe rules)
- `lib/scan-codex.mjs` — incremental Codex rollout ingest (delta events, replay-safe ids)
- `lib/statusline.mjs` — `gauge statusline` render; merges measured $ with the payload's official %
- `lib/pricing.mjs` — price table + cost(); update here when vendors reprice
- `lib/db.mjs` — schema (`files`, `events` incl. `source`), pre-0.3 column migration
- `data/burn.db` — sqlite; gitignored

## Rules

- No LLM calls, no network — purely mechanical over local files.
- Never present API-$ as "what you owe"; always label as API-equivalent.
- Timestamps UTC (box timezone).
