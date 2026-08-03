// `gauge statusline` — one line for Claude Code's statusLine slot. Claude Code
// pipes a JSON payload on stdin (model, workspace, and on recent versions
// rate_limits with official used percentages); gauge adds the half the payload
// can't know: measured API-equivalent dollars and where they went. Statuslines
// fire far more often than data changes, so the transcript rescan is throttled
// to once a minute via a marker file. Never fails loudly — a statusline that
// throws erases itself, so every path degrades to printing something.
import fs from 'node:fs';
import path from 'node:path';
import { db, DATA_DIR } from './db.mjs';
import { cost } from './pricing.mjs';
import { scan } from './scan.mjs';
import { scanCodex } from './scan-codex.mjs';

const HOUR = 3600_000;
const iso = (t) => new Date(t).toISOString();

function readStdin(ms = 300) {
  if (process.stdin.isTTY) return Promise.resolve('');
  return new Promise((resolve) => {
    let buf = '';
    const timer = setTimeout(() => resolve(buf), ms);
    process.stdin.on('data', (c) => { buf += c; });
    process.stdin.on('end', () => { clearTimeout(timer); resolve(buf); });
  });
}

export async function statusline() {
  try {
    let payload = {};
    try { payload = JSON.parse(await readStdin()); } catch { /* render without it */ }

    const marker = path.join(DATA_DIR, 'scan-marker');
    let fresh = false;
    try { fresh = Date.now() - fs.statSync(marker).mtimeMs < 60_000; } catch { /* no marker yet */ }
    if (!fresh) {
      await scan({ quiet: true });
      await scanCodex({ quiet: true });
      fs.writeFileSync(marker, '');
    }

    const now = Date.now();
    const hourly = new Map();
    for (const r of db.prepare(`
      SELECT substr(ts, 1, 13) AS hour, model,
             SUM(input) input, SUM(output) output, SUM(cache_read) cache_read,
             SUM(cache_5m) cache_5m, SUM(cache_1h) cache_1h
      FROM events WHERE source = 'claude' GROUP BY hour, model`).all()) {
      hourly.set(r.hour, (hourly.get(r.hour) ?? 0) + (cost(r) ?? 0));
    }

    let cur5h = 0;
    for (let k = 0; k < 5; k++) cur5h += hourly.get(iso(now - k * HOUR).slice(0, 13)) ?? 0;

    const hours = [...hourly.keys()].sort();
    let max5h = 0;
    if (hours.length) {
      const first = Date.parse(hours[0] + ':00:00Z');
      for (let t = first; t <= now; t += HOUR) {
        let s = 0;
        for (let k = 0; k < 5; k++) s += hourly.get(iso(t - k * HOUR).slice(0, 13)) ?? 0;
        if (s > max5h) max5h = s;
      }
    }

    const week = iso(now - 7 * 24 * HOUR).slice(0, 13);
    let d7 = 0;
    for (const [h, v] of hourly) if (h >= week) d7 += v;

    const byProject = db.prepare(`
      SELECT COALESCE(project, '?') project, model,
             SUM(input) input, SUM(output) output, SUM(cache_read) cache_read,
             SUM(cache_5m) cache_5m, SUM(cache_1h) cache_1h
      FROM events WHERE source = 'claude' AND ts >= ? GROUP BY project, model`)
      .all(iso(now - 5 * HOUR));
    const projTotals = new Map();
    for (const r of byProject) projTotals.set(r.project, (projTotals.get(r.project) ?? 0) + (cost(r) ?? 0));
    const top = [...projTotals.entries()].sort((a, b) => b[1] - a[1])[0];

    const $ = (n) => n >= 100 ? `$${n.toFixed(0)}` : n >= 10 ? `$${n.toFixed(1)}` : `$${n.toFixed(2)}`;
    const parts = [`5h ${$(cur5h)}`];
    if (max5h) parts.push(`${Math.round((cur5h / max5h) * 100)}% of peak`);
    parts.push(`7d ${$(d7)}`);
    if (top && top[1] >= 0.005) parts.push(`top ${top[0]}`);

    // official plan percentages, when this Claude Code version pipes them
    const rl = payload.rate_limits ?? {};
    const p5 = rl.five_hour?.used_percentage ?? rl.five_hour?.utilization;
    const p7 = rl.seven_day?.used_percentage ?? rl.seven_day?.utilization;
    const plan = [];
    if (typeof p5 === 'number') plan.push(`5h ${Math.round(p5)}%`);
    if (typeof p7 === 'number') plan.push(`wk ${Math.round(p7)}%`);
    if (plan.length) parts.push(`plan ${plan.join(' ')}`);

    console.log(parts.join(' · '));
  } catch {
    console.log('gauge —');
  }
}
