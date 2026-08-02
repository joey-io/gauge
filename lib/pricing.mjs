// API list prices per MTok — the common currency for burn. Plans don't publish
// quota mechanics, so "what this usage would cost at API rates" is the honest
// scalar. Cache read bills ~0.1x input; cache writes 1.25x (5m) / 2x (1h).
// Source: claude-api skill pricing table, cached 2026-06.
const PRICES = [
  [/^claude-(fable|mythos)/, { in: 10, out: 50 }],
  [/^claude-opus/, { in: 5, out: 25 }],
  [/^claude-sonnet/, { in: 3, out: 15 }],
  [/^claude-haiku-4/, { in: 1, out: 5 }],
  [/^claude-3-5-haiku/, { in: 0.8, out: 4 }],
];
const DEFAULT = { in: 5, out: 25 };

export function rate(model) {
  for (const [re, p] of PRICES) if (re.test(model)) return p;
  return DEFAULT;
}

// e is an events row (or aggregate with the same fields). Returns dollars.
export function cost(e) {
  const p = rate(e.model);
  return (
    (e.input * p.in +
      e.output * p.out +
      e.cache_read * p.in * 0.1 +
      e.cache_5m * p.in * 1.25 +
      e.cache_1h * p.in * 2) / 1e6
  );
}
