// Incremental ingest of Claude Code transcripts (~/.claude/projects/**/*.jsonl)
// into events. A file is re-parsed only when its mtime/size changed; within a
// file, INSERT OR REPLACE keyed on message id keeps the last (final) usage for
// streamed messages and absorbs cross-file replays from resumed sessions.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';
import { db } from './db.mjs';

const PROJECTS = path.join(os.homedir(), '.claude', 'projects');

const upsertFile = db.prepare('INSERT OR REPLACE INTO files (path, mtime, size) VALUES (?, ?, ?)');
const getFile = db.prepare('SELECT mtime, size FROM files WHERE path = ?');
const upsertEvent = db.prepare(`INSERT OR REPLACE INTO events
  (id, ts, model, project, input, output, cache_read, cache_5m, cache_1h)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);

function* jsonlFiles(dir = PROJECTS) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* jsonlFiles(full);
    else if (e.name.endsWith('.jsonl')) yield full;
  }
}

async function parseFile(file) {
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  let rows = 0;
  for await (const line of rl) {
    if (!line.includes('"usage"') || !line.includes('"assistant"')) continue;
    let d;
    try { d = JSON.parse(line); } catch { continue; }
    if (d.type !== 'assistant') continue;
    const m = d.message;
    const u = m?.usage;
    if (!u || !m.model || m.model.startsWith('<')) continue;
    const id = m.id || d.requestId;
    if (!id || !d.timestamp) continue;
    const c5 = u.cache_creation?.ephemeral_5m_input_tokens ?? u.cache_creation_input_tokens ?? 0;
    const c1 = u.cache_creation?.ephemeral_1h_input_tokens ?? 0;
    const project = d.cwd ? path.basename(d.cwd) || d.cwd : null;
    upsertEvent.run(
      id,
      d.timestamp,
      m.model,
      project,
      u.input_tokens ?? 0,
      u.output_tokens ?? 0,
      u.cache_read_input_tokens ?? 0,
      u.cache_creation ? c5 : (u.cache_creation_input_tokens ?? 0),
      u.cache_creation ? c1 : 0,
    );
    rows++;
  }
  return rows;
}

export async function scan({ quiet = false } = {}) {
  let files = 0, changed = 0;
  for (const file of jsonlFiles()) {
    files++;
    const st = fs.statSync(file);
    const prev = getFile.get(file);
    if (prev && prev.mtime === st.mtimeMs && prev.size === st.size) continue;
    changed++;
    if (!quiet) process.stderr.write(`\rgauge scan: ${changed} changed / ${files} files`);
    await parseFile(file);
    upsertFile.run(file, st.mtimeMs, st.size);
  }
  if (!quiet && changed) process.stderr.write('\n');
  return { files, changed };
}
