// gauge — sqlite store. Schema lives here.
// Data lives in ~/.cache/gauge (override with GAUGE_DATA_DIR) so the CLI works
// the same whether run from a checkout, npx, or a global install.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const DATA_DIR = process.env.GAUGE_DATA_DIR
  || path.join(os.homedir(), '.cache', 'gauge');
fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, 'gauge.db'));

db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS files (
    path  TEXT PRIMARY KEY,
    mtime INTEGER NOT NULL,
    size  INTEGER NOT NULL
  );
  -- one row per API message (deduped by message id; streamed chunk lines
  -- repeat the same id, and resumed sessions can replay messages across files)
  CREATE TABLE IF NOT EXISTS events (
    id           TEXT PRIMARY KEY,
    ts           TEXT NOT NULL,
    model        TEXT NOT NULL,
    project      TEXT,
    input        INTEGER DEFAULT 0,
    output       INTEGER DEFAULT 0,
    cache_read   INTEGER DEFAULT 0,
    cache_5m     INTEGER DEFAULT 0,
    cache_1h     INTEGER DEFAULT 0,
    source       TEXT NOT NULL DEFAULT 'claude'
  );
  CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);
`);

// pre-0.3 databases predate the source column
const cols = db.prepare(`SELECT name FROM pragma_table_info('events')`).all().map((r) => r.name);
if (!cols.includes('source')) {
  db.exec(`ALTER TABLE events ADD COLUMN source TEXT NOT NULL DEFAULT 'claude'`);
}
