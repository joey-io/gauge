// gauge page — send the current reading to Page (https://a-gnt.com/page).
//
// Gauge measures backward, Page reaches forward. Pairing them means the
// per-project breakdown lands on your phone instead of waiting for you to be
// at a terminal. Same zero-dependency rule as everything else here: this talks
// to the Page REST API directly rather than shelling out to the `page` CLI, so
// it works on a box where only the token is present.
//
// Credentials come from PAGER_URL / PAGER_TOKEN, else ~/.config/pager/config.json
// (written by `page login`).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { db } from './db.mjs';
import { cost } from './pricing.mjs';
import { scan } from './scan.mjs';
import { scanCodex } from './scan-codex.mjs';

function pagerConfig() {
  let cfg = {};
  try {
    cfg = JSON.parse(
      fs.readFileSync(path.join(os.homedir(), '.config', 'pager', 'config.json'), 'utf8'),
    );
  } catch {
    // no config file is fine as long as the env vars are set
  }
  return {
    url: (process.env.PAGER_URL || cfg.url || 'https://a-gnt.com/page').replace(/\/$/, ''),
    token: process.env.PAGER_TOKEN || cfg.token || null,
  };
}

const money = (n) => (n >= 100 ? `$${Math.round(n)}` : `$${n.toFixed(2)}`);

/** Per-project totals for the window, biggest first. */
function byProject(sinceIso, source) {
  const rows = db
    .prepare(
      `SELECT COALESCE(project,'?') project, model,
              SUM(input) input, SUM(output) output,
              SUM(cache_read) cache_read, SUM(cache_5m) cache_5m, SUM(cache_1h) cache_1h
         FROM events WHERE source = ? AND ts >= ?
        GROUP BY project, model`,
    )
    .all(source, sinceIso);
  const totals = new Map();
  for (const r of rows) totals.set(r.project, (totals.get(r.project) ?? 0) + (cost(r) ?? 0));
  return [...totals.entries()].filter(([, c]) => c > 0).sort((a, b) => b[1] - a[1]);
}

export async function pageReport({ days = 7, quiet = true, dryRun = false } = {}) {
  await scan({ quiet });
  await scanCodex({ quiet });

  const since = new Date(Date.now() - days * 86400_000).toISOString();
  const claude = byProject(since, 'claude');
  const codex = byProject(since, 'codex');
  const claudeTotal = claude.reduce((a, [, c]) => a + c, 0);
  const codexTotal = codex.reduce((a, [, c]) => a + c, 0);

  if (!claude.length && !codex.length) {
    return { skipped: true, reason: `no recorded usage in the last ${days}d` };
  }

  const title =
    `${money(claudeTotal)} across ${claude.length} project${claude.length === 1 ? '' : 's'} (${days}d)`;

  const lines = [];
  for (const [project, c] of claude.slice(0, 12)) {
    const share = claudeTotal ? Math.round((c / claudeTotal) * 100) : 0;
    lines.push(`${money(c).padStart(7)}  ${String(share).padStart(3)}%  ${project}`);
  }
  if (claude.length > 12) lines.push(`         …and ${claude.length - 12} more`);
  if (codex.length) {
    lines.push('');
    lines.push(`codex, separate plan: ${money(codexTotal)} across ${codex.length}`);
    for (const [project, c] of codex.slice(0, 5)) {
      lines.push(`${money(c).padStart(7)}         ${project}`);
    }
  }
  lines.push('');
  lines.push('API-list-equivalent dollars — a measure, not a bill.');

  const body = lines.join('\n');
  if (dryRun) return { dryRun: true, title, body };

  const { url, token } = pagerConfig();
  if (!token) {
    throw new Error(
      'no Page token — run `page login`, or set PAGER_TOKEN (see https://a-gnt.com/page)',
    );
  }

  const res = await fetch(`${url}/api/pages`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      type: 'update',
      title,
      body,
      url: 'https://a-gnt.com/gauge',
      source: { type: 'cli', name: os.hostname(), user: os.userInfo().username, app: 'gauge' },
    }),
  });
  if (!res.ok) {
    throw new Error(`Page API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const { page } = await res.json();
  return { id: page?.id, title, body };
}
