// API list prices per MTok — the common currency for burn. Plans don't publish
// quota mechanics, so "what this usage would cost at API rates" is the honest
// scalar. Anthropic: cache read bills ~0.1x input, cache writes 1.25x (5m) /
// 2x (1h). OpenAI (codex rollouts): cached input has its own list rate and
// cache writes are free, so those entries pin w5/w1 to 0. A model with no
// entry and no safe family default renders as token counts, never as invented
// dollars — add the rate here when the vendor publishes it.
// Source: claude-api skill pricing table cached 2026-06; OpenAI list 2026-01.
const PRICES = [
  [/^claude-(fable|mythos)/, { in: 10, out: 50 }],
  [/^claude-opus/, { in: 5, out: 25 }],
  [/^claude-sonnet/, { in: 3, out: 15 }],
  [/^claude-haiku-4/, { in: 1, out: 5 }],
  [/^claude-3-5-haiku/, { in: 0.8, out: 4 }],
  [/^gpt-5.*-mini/, { in: 0.25, cached: 0.025, out: 2, w5: 0, w1: 0 }],
  [/^gpt-5.*-nano/, { in: 0.05, cached: 0.005, out: 0.4, w5: 0, w1: 0 }],
  [/^gpt-5/, { in: 1.25, cached: 0.125, out: 10, w5: 0, w1: 0 }],
  [/^codex-mini/, { in: 1.5, cached: 0.375, out: 6, w5: 0, w1: 0 }],
  [/^o3(-|$)/, { in: 2, cached: 0.5, out: 8, w5: 0, w1: 0 }],
  [/^o4-mini/, { in: 1.1, cached: 0.275, out: 4.4, w5: 0, w1: 0 }],
];
// unknown Claude models still price at a mid Anthropic rate; unknown models
// from other vendors get null (no honest guess exists)
const CLAUDE_DEFAULT = { in: 5, out: 25 };

export function rate(model) {
  for (const [re, p] of PRICES) if (re.test(model)) return p;
  return /^claude/.test(model) ? CLAUDE_DEFAULT : null;
}

// e is an events row (or aggregate with the same fields). Returns dollars, or
// null when the model has no known list rate.
export function cost(e) {
  const p = rate(e.model);
  if (!p) return null;
  return (
    (e.input * p.in +
      e.output * p.out +
      e.cache_read * (p.cached ?? p.in * 0.1) +
      e.cache_5m * (p.w5 ?? p.in * 1.25) +
      e.cache_1h * (p.w1 ?? p.in * 2)) / 1e6
  );
}
