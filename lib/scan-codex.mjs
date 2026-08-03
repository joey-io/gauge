// Incremental ingest of Codex CLI rollouts ($CODEX_HOME/sessions/**/rollout-*.jsonl,
// plus archived_sessions) into events with source='codex'. Codex doesn't log
// per-message API usage the way Claude Code does; it emits event_msg/token_count
// lines carrying a per-turn delta (last_token_usage) beside the session-cumulative
// total. The dedupe id is timestamp + both totals, so a forked or copied rollout
// that replays history collapses onto the same rows instead of double-counting.
// Model and cwd come from the nearest preceding turn_context line (session_meta
// seeds cwd); cached_input is a subset of input, and cache writes land in the
// cache_5m column (priced 0 for OpenAI in pricing.mjs).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';
import { db } from './db.mjs';

const CODEX_HOME = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');

const upsertFile = db.prepare('INSERT OR REPLACE INTO files (path, mtime, size) VALUES (?, ?, ?)');
const getFile = db.prepare('SELECT mtime, size FROM files WHERE path = ?');
const upsertEvent = db.prepare(`INSERT OR REPLACE INTO events
  (id, ts, model, project, input, output, cache_read, cache_5m, cache_1h, source)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 'codex')`);

function* rolloutFiles(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* rolloutFiles(full);
    else if (e.name.startsWith('rollout-') && e.name.endsWith('.jsonl')) yield full;
  }
}

async function parseFile(file) {
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  let model = 'codex-unknown';
  let project = null;
  for await (const line of rl) {
    // response_item lines dominate the file; skip them without parsing
    if (!/"(token_count|turn_context|session_meta)"/.test(line)) continue;
    let d;
    try { d = JSON.parse(line); } catch { continue; }
    const p = d.payload;
    if (!p) continue;
    if (d.type === 'turn_context' || d.type === 'session_meta') {
      const cwd = p.cwd ?? p.meta?.cwd;
      if (cwd) project = path.basename(cwd) || cwd;
      if (p.model) model = p.model;
      continue;
    }
    if (d.type !== 'event_msg' || p.type !== 'token_count') continue;
    const last = p.info?.last_token_usage;
    if (!last || !d.timestamp || !(last.total_tokens > 0)) continue;
    const cached = Math.max(0, last.cached_input_tokens ?? 0);
    upsertEvent.run(
      `codex:${d.timestamp}:${p.info.total_token_usage?.total_tokens ?? 0}:${last.total_tokens}`,
      d.timestamp,
      model,
      project,
      Math.max(0, (last.input_tokens ?? 0) - cached),
      Math.max(0, last.output_tokens ?? 0),
      cached,
      Math.max(0, last.cache_write_input_tokens ?? 0),
    );
  }
}

export async function scanCodex({ quiet = false } = {}) {
  let files = 0, changed = 0;
  for (const sub of ['sessions', 'archived_sessions']) {
    for (const file of rolloutFiles(path.join(CODEX_HOME, sub))) {
      files++;
      const st = fs.statSync(file);
      const prev = getFile.get(file);
      if (prev && prev.mtime === st.mtimeMs && prev.size === st.size) continue;
      changed++;
      if (!quiet) process.stderr.write(`\rgauge scan (codex): ${changed} changed / ${files} files`);
      await parseFile(file);
      upsertFile.run(file, st.mtimeMs, st.size);
    }
  }
  if (!quiet && changed) process.stderr.write('\n');
  return { files, changed };
}
