/*
 * Demo data provider — generates fake but deterministic candles so the app
 * runs with zero setup (no API key, no network).
 *
 * Provider interface:
 *   fetchCandles(symbol, { timeframe }) -> Promise<Candle[]>            (newest-first, for scanning)
 *   fetchSeries(symbol,  { timeframe }) -> Promise<Candle[]>            (oldest-first, for charts)
 * matching the live provider so they're interchangeable.
 *
 * Detection is per-timeframe: each timeframe assigns the ten tickers a rotated
 * slice of the scenario list, so every timeframe shows a full Buy/Sell/Hold mix
 * AND a given ticker's signal differs across timeframes (like real markets).
 */
import { WATCHLIST } from "../config/watchlist.js";
import { TIMEFRAMES } from "../config/timeframes.js";
import { detectPattern } from "../core/patterns.js";

// Each scenario specifies the three most-recent candles (prev2 = oldest,
// prev = middle, cur = newest) as offsets from a per-symbol base price,
// engineered so a specific detector fires first under the priority order (or
// none at all). One scenario per pattern (plus a "none") so every pattern
// appears somewhere across the tickers/timeframes, and the signal filters have
// something to show for each. `kind` also selects an optional intensity sweep
// (see `intensify`) that varies the pattern's strength.
const SCENARIOS = [
  { kind: "morningStar", prev2: { o: 4, h: 5, l: -5, c: -4 }, prev: { o: -5, h: -4.5, l: -6, c: -5.5 }, cur: { o: -4, h: 4, l: -5, c: 3 } }, // Morning Star
  { kind: "eveningStar", prev2: { o: -4, h: 5, l: -5, c: 4 }, prev: { o: 5, h: 6, l: 4.5, c: 5.5 }, cur: { o: 4, h: 5, l: -4, c: -3 } }, // Evening Star
  { kind: "threeSoldiers", prev2: { o: -6, h: -1, l: -7, c: -2 }, prev: { o: -3, h: 2, l: -4, c: 1 }, cur: { o: 0, h: 5, l: -1, c: 4 } }, // Three White Soldiers
  { kind: "threeCrows", prev2: { o: 6, h: 7, l: 1, c: 2 }, prev: { o: 3, h: 4, l: -2, c: -1 }, cur: { o: 0, h: 1, l: -5, c: -4 } }, // Three Black Crows
  { kind: "bullEngulf", prev2: { o: -1, h: 2, l: -2, c: 1 }, prev: { o: 4, h: 5, l: -3, c: -2 }, cur: { o: -3, h: 6, l: -4, c: 5 } }, // Bullish Engulfing
  { kind: "bearEngulf", prev2: { o: 1, h: 2, l: -2, c: -1 }, prev: { o: -2, h: 5, l: -3, c: 4 }, cur: { o: 5, h: 6, l: -4, c: -3 } }, // Bearish Engulfing
  { kind: "piercing", prev2: { o: -1, h: 2, l: -2, c: 1 }, prev: { o: 4, h: 5, l: -3, c: -2 }, cur: { o: -4, h: 3, l: -5, c: 2 } }, // Piercing Line
  { kind: "darkCloud", prev2: { o: 1, h: 2, l: -2, c: -1 }, prev: { o: -2, h: 5, l: -3, c: 4 }, cur: { o: 6, h: 7, l: -1, c: 0 } }, // Dark Cloud Cover
  { kind: "bullHarami", prev2: { o: 5, h: 6, l: 4, c: 5.5 }, prev: { o: 4, h: 4.5, l: -4.5, c: -4 }, cur: { o: -2, h: -1, l: -2.5, c: -1 } }, // Bullish Harami
  { kind: "bearHarami", prev2: { o: -5, h: -4, l: -6, c: -5.5 }, prev: { o: -4, h: 4.5, l: -4.5, c: 4 }, cur: { o: 1, h: 1.5, l: 0, c: 0 } }, // Bearish Harami
  { kind: "tweezerBottom", prev2: { o: 0, h: 1, l: -1, c: 0.5 }, prev: { o: 2, h: 2.5, l: -2, c: -1 }, cur: { o: -1, h: 1, l: -2, c: 1 } }, // Tweezer Bottom
  { kind: "tweezerTop", prev2: { o: 0, h: 1, l: -1, c: -0.5 }, prev: { o: -1, h: 3, l: -1.5, c: 2 }, cur: { o: 1, h: 3, l: -1, c: -1 } }, // Tweezer Top
  { kind: "dragonfly", prev2: { o: 0, h: 1, l: -1, c: 0.3 }, prev: { o: 1, h: 2, l: 0, c: 0.5 }, cur: { o: 0, h: 0.1, l: -6, c: 0.05 } }, // Dragonfly Doji
  { kind: "gravestone", prev2: { o: 0, h: 1, l: -1, c: 0.3 }, prev: { o: 1, h: 2, l: 0, c: 0.5 }, cur: { o: 0, h: 6, l: -0.1, c: -0.05 } }, // Gravestone Doji
  { kind: "doji", prev2: { o: -1, h: 2, l: -2, c: 1 }, prev: { o: 2, h: 3, l: -3, c: -2 }, cur: { o: 0, h: 3, l: -3, c: 0.05 } }, // Doji
  { kind: "bullMaru", prev2: { o: 1, h: 2, l: -2, c: -1 }, prev: { o: 0, h: 3, l: -1, c: 2 }, cur: { o: -4, h: 4, l: -4, c: 4 } }, // Bullish Marubozu
  { kind: "bearMaru", prev2: { o: -1, h: 2, l: -2, c: 1 }, prev: { o: 0, h: 1, l: -3, c: -2 }, cur: { o: 4, h: 4, l: -4, c: -4 } }, // Bearish Marubozu
  { kind: "hammer", prev2: { o: -1, h: 2, l: -2, c: 1 }, prev: { o: 6, h: 6.5, l: 2.5, c: 3 }, cur: { o: 3, h: 4.5, l: -2, c: 4 } }, // Hammer
  { kind: "hangingMan", prev2: { o: -2, h: -1, l: -3, c: -1.5 }, prev: { o: 0, h: 6.5, l: -0.5, c: 6 }, cur: { o: 3, h: 4.5, l: -2, c: 4 } }, // Hanging Man
  { kind: "invHammer", prev2: { o: -1, h: 2, l: -2, c: 1 }, prev: { o: 4, h: 5, l: -3, c: -2 }, cur: { o: -1, h: 5, l: -1.5, c: 0 } }, // Inverted Hammer
  { kind: "shootingStar", prev2: { o: 1, h: 2, l: -2, c: -1 }, prev: { o: -2, h: 5, l: -3, c: 4 }, cur: { o: 0, h: 4.5, l: -1.5, c: -1 } }, // Shooting Star
  { kind: "spinningTop", prev2: { o: -0.5, h: 0.5, l: -1, c: 0 }, prev: { o: 1, h: 1.5, l: 0.5, c: 0.8 }, cur: { o: 0, h: 2.5, l: -2, c: 0.6 } }, // Spinning Top
  { kind: "none", prev2: { o: -1, h: 1.5, l: -2, c: 1 }, prev: { o: -1, h: 1, l: -2, c: 0.5 }, cur: { o: 0, h: 2.5, l: -1, c: 2 } }, // none
];

const TF_KEYS = Object.keys(TIMEFRAMES);

function symbolHash(symbol) {
  return [...symbol].reduce((a, c) => a + c.charCodeAt(0), 0);
}

function watchIndex(symbol) {
  const i = WATCHLIST.findIndex((w) => w.symbol === symbol);
  return i >= 0 ? i : symbolHash(symbol);
}

// The scenario for a (symbol, timeframe): the ticker's position rotated by the
// timeframe's position, so each timeframe shows the whole mix in a different order.
function scenarioFor(symbol, timeframe) {
  const tfIdx = Math.max(0, TF_KEYS.indexOf(timeframe));
  return SCENARIOS[(watchIndex(symbol) + tfIdx) % SCENARIOS.length];
}

// A deterministic per-(symbol, timeframe) intensity in [0,1] — used to vary how
// strongly a pattern is expressed, so the strength score spans a real range
// instead of being constant per pattern type.
function intensityFor(symbol, timeframe) {
  const seed = symbolHash(symbol) * 2654435761 + [...timeframe].reduce((a, c) => a + c.charCodeAt(0), 0) * 40503;
  return prng(seed >>> 0)();
}

// Returns a copy of a scenario with the decisive candle(s) scaled by intensity
// `k`, keeping the pattern valid but varying its degree (marginal → textbook).
function intensify(s, k) {
  switch (s.kind) {
    case "bullEngulf": {
      const c = 5 + k * 9; // bigger green body that engulfs further
      const o = -3 - k * 1.5;
      return { ...s, cur: { o, c, h: c + 1, l: o - 1 } };
    }
    case "darkCloud": {
      const o = 6 + k * 1.5; // deeper penetration + bigger body (stays above prev open)
      const c = 0.6 - k * 2.4;
      return { ...s, cur: { o, c, h: o + 1, l: c - 1 } };
    }
    case "morningStar": {
      const c = 1.5 + k * 6.5; // stronger third candle driving into the first body
      return { ...s, cur: { o: -4, c, h: c + 1, l: -5 } };
    }
    case "hammer": {
      const l = 3 - (3.5 + k * 3); // long lower wick (3.5–6.5× body); range stays big enough
      return { ...s, cur: { o: 3, c: 4, h: 4.5, l } }; // to avoid the Harami "small inside candle" rule
    }
    case "threeCrows": {
      const wick = 1 - k * 0.8; // tighter wicks + a bigger final body = fuller, stronger
      const tighten = (o) => ({ ...o, h: Math.max(o.o, o.c) + wick, l: Math.min(o.o, o.c) - wick });
      const c = -4 - k * 5;
      return { ...s, prev2: tighten(s.prev2), prev: tighten(s.prev), cur: { o: 0, c, h: wick, l: c - wick } };
    }
    default:
      return s; // doji / none — no directional strength to vary
  }
}

// The (intensity-adjusted) scenario for a symbol on a timeframe.
function builtScenario(symbol, timeframe) {
  return intensify(scenarioFor(symbol, timeframe), intensityFor(symbol, timeframe));
}

// Build the three scenario candles (newest-first) at the symbol's price level.
function scenarioCandles(symbol, s) {
  const base = 50 + (symbolHash(symbol) % 200);
  const today = new Date();
  const day = (n) => {
    const d = new Date(today);
    d.setDate(d.getDate() - n);
    return d.toISOString().slice(0, 10);
  };
  const build = (o, dt) => ({ datetime: dt, open: base + o.o, high: base + o.h, low: base + o.l, close: base + o.c });
  return [build(s.cur, day(0)), build(s.prev, day(1)), build(s.prev2, day(2))];
}

// The symbol's baseline candles (the 1-min / offset-0 scenario). Kept for tests.
export function demoCandles(symbol) {
  return scenarioCandles(symbol, SCENARIOS[watchIndex(symbol) % SCENARIOS.length]);
}

// Scan candles for the selected timeframe — detection runs on these.
export async function fetchCandles(symbol, { timeframe } = {}) {
  return scenarioCandles(symbol, builtScenario(symbol, timeframe));
}

// Synchronous detected pattern for a symbol/timeframe (or null) — used to filter
// the table by signal type without an async round-trip.
export function demoPattern(symbol, timeframe) {
  return detectPattern(scenarioCandles(symbol, builtScenario(symbol, timeframe)));
}

// The highlight band for a symbol's pattern on a timeframe, or null if that
// timeframe's scenario is "none". Pattern sits at the end of the series.
export function demoHighlight(symbol, timeframe) {
  const pattern = detectPattern(scenarioCandles(symbol, builtScenario(symbol, timeframe)));
  if (!pattern) return null;
  const n = (TIMEFRAMES[timeframe] || TIMEFRAMES.daily).outputsize;
  return { start: n - pattern.candles, end: n - 1, bias: pattern.bias, name: pattern.name };
}

// Small deterministic PRNG (mulberry32) so demo charts are stable per symbol.
function prng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function intervalMs(interval) {
  const m = /^(\d+)(min|h|day|week)$/.exec(interval);
  if (!m) return 86400000;
  const unit = { min: 60000, h: 3600000, day: 86400000, week: 604800000 }[m[2]];
  return Number(m[1]) * unit;
}

// A seeded random walk of `n` candles with solid bodies + small balanced wicks,
// so the background produces no incidental single-candle patterns. Real datetimes
// are spaced by the timeframe's interval.
function walk(seed, base, n, interval) {
  const rand = prng(seed);
  const stepMs = intervalMs(interval);
  const now = Date.now();
  const series = [];
  let price = base;
  for (let i = 0; i < n; i++) {
    const dir = rand() < 0.5 ? 1 : -1;
    const body = base * (0.006 + rand() * 0.01);
    const open = price;
    const close = Math.max(1, open + dir * body);
    const high = Math.max(open, close) + body * (0.3 + rand() * 0.5);
    const low = Math.min(open, close) - body * (0.3 + rand() * 0.5);
    const iso = new Date(now - (n - 1 - i) * stepMs).toISOString();
    const datetime = stepMs >= 86400000 ? iso.slice(0, 10) : iso.slice(0, 16).replace("T", " ");
    series.push({ datetime, open, high, low, close });
    price = close;
  }
  return series;
}

// Overwrite the last three candles with a scenario, stitched onto the walk for
// price continuity (datetimes preserved).
function applyScenarioTail(series, symbol, s) {
  if (series.length < 3) return series;
  const base = 50 + (symbolHash(symbol) % 200);
  const tail = [s.prev2, s.prev, s.cur]; // oldest-first offsets
  const anchor = series.length - 4 >= 0 ? series[series.length - 4].close : base + tail[0].o;
  const shift = anchor - (base + tail[0].o);
  for (let k = 0; k < 3; k++) {
    const o = tail[k];
    const slot = series[series.length - 3 + k];
    series[series.length - 3 + k] = {
      datetime: slot.datetime,
      open: base + o.o + shift,
      high: base + o.h + shift,
      low: base + o.l + shift,
      close: base + o.c + shift,
    };
  }
  return series;
}

/*
 * A chart series for one symbol/timeframe (oldest-first): a seeded random walk
 * with that timeframe's scenario embedded at the end, so the highlighted pattern
 * matches the table's signal for the same timeframe.
 */
export function demoSeries(symbol, timeframe) {
  const tf = TIMEFRAMES[timeframe] || TIMEFRAMES.daily;
  const symbolSum = symbolHash(symbol);
  const tfSum = [...timeframe].reduce((a, c) => a + c.charCodeAt(0), 0);
  const base = 50 + (symbolSum % 200);
  const series = walk(symbolSum + tfSum * 97, base, tf.outputsize, tf.interval);
  return applyScenarioTail(series, symbol, builtScenario(symbol, timeframe));
}

export async function fetchSeries(symbol, { timeframe } = {}) {
  return demoSeries(symbol, timeframe);
}
