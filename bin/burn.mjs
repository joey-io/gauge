#!/usr/bin/env -S node --no-warnings=ExperimentalWarning
// gauge — a local meter for your Claude Code plan. Reads the transcripts
// Claude Code already writes, dedupes to real API messages, and answers:
// what's eating my allowance, and how fast. Costs are API-list-equivalent
// dollars — plans don't expose quota mechanics, so this is the honest common
// currency, not a bill.
// Usage: gauge [--days N]  (default window for the breakdown sections: 7)
import { db } from '../lib/db.mjs';
import { cost } from '../lib/pricing.mjs';
import { scan } from '../lib/scan.mjs';
import { activate, licensed } from '../lib/license.mjs';

const argv = process.argv.slice(2);

if (argv[0] === 'activate') {
  if (activate(argv[1] ?? '')) {
    console.log('license verified and saved — thanks for supporting gauge');
  } else {
    console.error('that key did not verify — check for copy-paste damage, or write joey@a-gnt.com');
    process.exit(1);
  }
  process.exit(0);
}

const daysFlag = argv.indexOf('--days');
const DAYS = daysFlag >= 0 ? Number(argv[daysFlag + 1]) : 7;

await scan();

const now = Date.now();
const iso = (t) => new Date(t).toISOString();
const HOUR = 3600_000;

// hourly cost buckets across all history (for window math)
const hourly = new Map(); // '2026-08-02T19' -> $
for (const r of db.prepare(`
  SELECT substr(ts, 1, 13) AS hour, model,
         SUM(input) input, SUM(output) output, SUM(cache_read) cache_read,
         SUM(cache_5m) cache_5m, SUM(cache_1h) cache_1h
  FROM events GROUP BY hour, model`).all()) {
  hourly.set(r.hour, (hourly.get(r.hour) ?? 0) + cost(r));
}

// max observed 5h window — the closest thing to "the wall" we can measure
const hours = [...hourly.keys()].sort();
let max5h = 0, max5hEnd = '';
if (hours.length) {
  const first = Date.parse(hours[0] + ':00:00Z');
  for (let t = first; t <= now; t += HOUR) {
    let s = 0;
    for (let k = 0; k < 5; k++) s += hourly.get(iso(t - k * HOUR).slice(0, 13)) ?? 0;
    if (s > max5h) { max5h = s; max5hEnd = iso(t).slice(0, 13); }
  }
}
let cur5h = 0;
for (let k = 0; k < 5; k++) cur5h += hourly.get(iso(now - k * HOUR).slice(0, 13)) ?? 0;

const since = iso(now - DAYS * 24 * HOUR);
const agg = (sql, ...params) => db.prepare(sql).all(...params)
  .map((r) => ({ ...r, cost: cost(r) }));

const byModel = agg(`
  SELECT model, COUNT(*) msgs, SUM(input) input, SUM(output) output,
         SUM(cache_read) cache_read, SUM(cache_5m) cache_5m, SUM(cache_1h) cache_1h
  FROM events WHERE ts >= ? GROUP BY model ORDER BY SUM(output) DESC`, since);

const byProject = agg(`
  SELECT COALESCE(project,'?') project, model, SUM(input) input, SUM(output) output,
         SUM(cache_read) cache_read, SUM(cache_5m) cache_5m, SUM(cache_1h) cache_1h
  FROM events WHERE ts >= ? GROUP BY project, model`, since);
const projTotals = new Map();
for (const r of byProject) projTotals.set(r.project, (projTotals.get(r.project) ?? 0) + r.cost);

const byDay = agg(`
  SELECT substr(ts, 1, 10) day, model, SUM(input) input, SUM(output) output,
         SUM(cache_read) cache_read, SUM(cache_5m) cache_5m, SUM(cache_1h) cache_1h
  FROM events WHERE ts >= ? GROUP BY day, model`, iso(now - 14 * 24 * HOUR));
const dayTotals = new Map();
for (const r of byDay) dayTotals.set(r.day, (dayTotals.get(r.day) ?? 0) + r.cost);

// ── render ──────────────────────────────────────────────────────────────
const W = 30;
const $ = (n) => n >= 100 ? `$${n.toFixed(0)}` : n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(3)}`;
const tok = (n) => n >= 1e9 ? (n / 1e9).toFixed(1) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M'
  : n >= 1e3 ? (n / 1e3).toFixed(0) + 'k' : String(n);
const bar = (v, maxV, w = W) => '█'.repeat(Math.min(w, Math.round((v / (maxV || 1)) * w))).padEnd(w);
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;

const today = iso(now).slice(0, 10);
const line = '─'.repeat(78);
console.log(bold('gauge — Claude Code usage meter') + dim(`  (API-equivalent $, UTC)  ${today}`));
console.log(line);

const pct = max5h ? Math.round((cur5h / max5h) * 100) : 0;
console.log(`last 5h    ${bar(cur5h, max5h)} ${$(cur5h).padStart(7)}  ${String(pct).padStart(3)}% of peak`);
console.log(dim(`peak 5h window ever: ${$(max5h)} (ending ${max5hEnd}Z) — your observed ceiling, not the plan limit`));
console.log('');

console.log(bold(`daily, last 14 days`));
const dayKeys = [...Array(14)].map((_, i) => iso(now - (13 - i) * 24 * HOUR).slice(0, 10));
const dayMax = Math.max(...dayKeys.map((d) => dayTotals.get(d) ?? 0), 0.01);
for (const d of dayKeys) {
  const v = dayTotals.get(d) ?? 0;
  const mark = d === today ? '◂ today' : '';
  console.log(`  ${d.slice(5)}  ${bar(v, dayMax, 40)} ${$(v).padStart(8)}  ${dim(mark)}`);
}
const weekSpend = dayKeys.slice(7).reduce((s, d) => s + (dayTotals.get(d) ?? 0), 0);
const prevWeek = dayKeys.slice(0, 7).reduce((s, d) => s + (dayTotals.get(d) ?? 0), 0);
console.log(dim(`  this 7d ${$(weekSpend)} vs prior 7d ${$(prevWeek)}`));
console.log('');

console.log(bold(`by model, last ${DAYS}d`));
for (const r of byModel) {
  console.log(`  ${r.model.padEnd(22)} ${$(r.cost).padStart(8)}  ${dim(`out ${tok(r.output).padStart(7)}  cache-r ${tok(r.cache_read).padStart(7)}  msgs ${r.msgs}`)}`);
}
console.log('');

console.log(bold(`by project, last ${DAYS}d`));
const projMax = Math.max(...projTotals.values(), 0.01);
for (const [p, v] of [...projTotals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
  console.log(`  ${p.slice(0, 20).padEnd(20)} ${bar(v, projMax, 28)} ${$(v).padStart(8)}`);
}
console.log(line);

const total = db.prepare('SELECT COUNT(*) n, MIN(ts) lo FROM events').get();
const lic = licensed() ? '' : '  ·  unlicensed — $3 once at gauge.joey.win';
console.log(dim(`${total.n} API messages since ${String(total.lo).slice(0, 10)} — data: ~/.claude/projects${lic}`));
