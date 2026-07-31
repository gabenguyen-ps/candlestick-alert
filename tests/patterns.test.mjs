/*
 * Tests for the pure detection core. Run with `npm test` (uses Node's built-in
 * test runner — no dependencies to install).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  detectPattern,
  findPatterns,
  suggestedAction,
  scorePattern,
  isBullishEngulfing,
  isBearishEngulfing,
} from "../src/core/patterns.js";
import { demoCandles, demoSeries, demoHighlight, fetchCandles } from "../src/providers/demo.js";
import { WATCHLIST } from "../src/config/watchlist.js";
import { TIMEFRAMES } from "../src/config/timeframes.js";

// The demo has one scenario per pattern (plus a "none"), assigned to tickers in
// watchlist order. `null` means "no pattern".
const EXPECTED_BY_INDEX = [
  "Morning Star",
  "Evening Star",
  "Three White Soldiers",
  "Three Black Crows",
  "Bullish Engulfing",
  "Bearish Engulfing",
  "Piercing Line",
  "Dark Cloud Cover",
  "Bullish Harami",
  "Bearish Harami",
  "Tweezer Bottom",
  "Tweezer Top",
  "Dragonfly Doji",
  "Gravestone Doji",
  "Doji",
  "Bullish Marubozu",
  "Bearish Marubozu",
  "Hammer",
  "Hanging Man",
  "Inverted Hammer",
  "Shooting Star",
  "Spinning Top",
  null,
];

test("baseline scenarios map to their intended pattern (one per pattern)", () => {
  WATCHLIST.slice(0, EXPECTED_BY_INDEX.length).forEach((item, i) => {
    const pattern = detectPattern(demoCandles(item.symbol));
    const got = pattern ? pattern.name : null;
    assert.equal(got, EXPECTED_BY_INDEX[i], `${item.symbol}`);
  });
});

test("demo surfaces every pattern with no mis-detections", () => {
  const names = new Set(WATCHLIST.slice(0, EXPECTED_BY_INDEX.length).map((item) => {
    const p = detectPattern(demoCandles(item.symbol));
    return p ? p.name : null;
  }));
  // All 22 named patterns are represented.
  const patternNames = EXPECTED_BY_INDEX.filter(Boolean);
  for (const n of patternNames) assert.ok(names.has(n), `missing ${n}`);
});

// Patterns not in the demo watchlist still detect correctly (three candles,
// newest-first, with an inert oldest candle so no higher-priority match fires).
test("non-demoed single-candle patterns detect via detectPattern", () => {
  const cases = [
    ["Doji", [
      { open: 0, high: 3, low: -3, close: 0.05 },
      { open: 2, high: 3, low: -3, close: -2 },
      { open: -1, high: 2, low: -2, close: 1 },
    ]],
    ["Bullish Marubozu", [
      { open: -4, high: 4, low: -4, close: 4 },
      { open: 0, high: 3, low: -1, close: 2 },
      { open: 1, high: 2, low: -2, close: -1 },
    ]],
    ["Bearish Marubozu", [
      { open: 4, high: 4, low: -4, close: -4 },
      { open: 0, high: 1, low: -3, close: -2 },
      { open: -1, high: 2, low: -2, close: 1 },
    ]],
    ["Inverted Hammer", [
      { open: -1, high: 5, low: -1.5, close: 0 },
      { open: 4, high: 5, low: -3, close: -2 },
      { open: -1, high: 2, low: -2, close: 1 },
    ]],
  ];
  for (const [name, candles] of cases) {
    const pattern = detectPattern(candles);
    assert.ok(pattern, `${name} should match`);
    assert.equal(pattern.name, name);
  }
});

test("bullish engulfing: positive and negative cases", () => {
  // prev red, cur green fully engulfing -> true
  assert.equal(isBullishEngulfing({ open: 9, high: 13, low: 8, close: 12 },
    { open: 11, high: 12, low: 9, close: 10 }), true);
  // both candles bullish -> false
  assert.equal(isBullishEngulfing({ open: 9, high: 13, low: 8, close: 12 },
    { open: 10, high: 12, low: 9, close: 11 }), false);
});

test("bearish engulfing is the mirror of bullish engulfing", () => {
  // prev green, cur red fully engulfing -> true
  assert.equal(isBearishEngulfing({ open: 12, high: 13, low: 8, close: 9 },
    { open: 10, high: 12, low: 9, close: 11 }), true);
});

test("detectPattern returns null with fewer than two candles", () => {
  assert.equal(detectPattern([]), null);
  assert.equal(detectPattern([{ open: 1, high: 2, low: 0, close: 1.5 }]), null);
});

test("findPatterns locates an occurrence in an oldest-first series", () => {
  // oldest-first: inert, prev (red), cur (green engulfing)
  const series = [
    { open: 10, high: 11, low: 9, close: 10.5 },
    { open: 11, high: 12, low: 9, close: 10 },
    { open: 9, high: 13, low: 8, close: 12 },
  ];
  const found = findPatterns(series);
  assert.ok(found.some((f) => f.name === "Bullish Engulfing" && f.end === 2));
});

test("every timeframe shows a variety of signals across tickers", async () => {
  for (const tf of Object.keys(TIMEFRAMES)) {
    const results = await Promise.all(
      WATCHLIST.map((w) => fetchCandles(w.symbol, { timeframe: tf }).then(detectPattern))
    );
    const signals = results.filter(Boolean).length;
    const holds = results.filter((p) => !p).length;
    assert.ok(signals >= 4, `${tf}: expected several signals, got ${signals}`);
    assert.ok(holds >= 2, `${tf}: expected some Hold rows, got ${holds}`);
  }
});

test("a ticker's signal varies across timeframes", async () => {
  const names = await Promise.all(
    Object.keys(TIMEFRAMES).map((tf) =>
      fetchCandles("NVDA", { timeframe: tf }).then((c) => detectPattern(c)?.name ?? "none")
    )
  );
  assert.ok(new Set(names).size >= 2, `expected NVDA to differ across timeframes, got ${names.join(",")}`);
});

test("demoHighlight matches the timeframe's scenario and sits at the series end", () => {
  // Find a timeframe where NVDA has a pattern and assert the band is at the end.
  const tf = Object.keys(TIMEFRAMES).find((k) => demoHighlight("NVDA", k));
  assert.ok(tf, "NVDA should have a pattern on at least one timeframe");
  assert.equal(demoHighlight("NVDA", tf).end, TIMEFRAMES[tf].outputsize - 1);
});

test("newly added patterns detect correctly (newest-first candles)", () => {
  const cases = [
    ["Hanging Man", [
      { open: 13, high: 14.2, low: 10, close: 14 },
      { open: 8, high: 12, low: 8, close: 12 },
    ]],
    ["Bullish Harami", [
      { open: 8, high: 9, low: 7.5, close: 9 },
      { open: 14, high: 14.5, low: 5.5, close: 6 },
    ]],
    ["Bearish Harami", [
      { open: 11, high: 11.5, low: 10, close: 10 },
      { open: 6, high: 14.5, low: 5.5, close: 14 },
    ]],
    ["Tweezer Bottom", [
      { open: 9, high: 11, low: 8, close: 11 },
      { open: 12, high: 12.5, low: 8, close: 9 },
    ]],
    ["Tweezer Top", [
      { open: 11, high: 13, low: 9, close: 9 },
      { open: 9, high: 13, low: 8.5, close: 12 },
    ]],
    ["Dragonfly Doji", [
      { open: 10, high: 10.1, low: 6, close: 10.05 },
      { open: 11, high: 11.5, low: 9, close: 9.5 },
    ]],
    ["Gravestone Doji", [
      { open: 6, high: 10, low: 5.95, close: 6.05 },
      { open: 5, high: 6, low: 4.5, close: 5.8 },
    ]],
    ["Spinning Top", [
      { open: 10, high: 12, low: 8, close: 10.6 },
      { open: 10, high: 11, low: 9, close: 10.5 },
    ]],
  ];
  for (const [name, candles] of cases) {
    const p = detectPattern(candles);
    assert.ok(p, `${name}: expected a match`);
    assert.equal(p.name, name, `expected ${name}`);
  }
});

test("scorePattern returns 0–100 for directional patterns, null for Doji/none", () => {
  // A strong bullish engulfing (big body engulfing wicks too) should score high.
  const strong = [
    { open: 9, high: 14, low: 8, close: 13 }, // cur: big green, engulfs wicks
    { open: 11, high: 11.5, low: 9.5, close: 10 }, // prev: small red
  ];
  const p = detectPattern(strong);
  const s = scorePattern(p, strong);
  assert.equal(p.name, "Bullish Engulfing");
  assert.ok(s >= 0 && s <= 100, `score in range, got ${s}`);
  assert.ok(s >= 60, `strong engulfing should score high, got ${s}`);

  // Doji (neutral) has no directional strength.
  const doji = [
    { open: 0, high: 3, low: -3, close: 0.05 },
    { open: 2, high: 3, low: -3, close: -2 },
  ];
  assert.equal(scorePattern(detectPattern(doji), doji), null);
  // No pattern -> null.
  assert.equal(scorePattern(null, doji), null);
});

test("demo strength varies across instances of the same pattern", async () => {
  const byPattern = new Map(); // name -> Set of scores
  for (const item of WATCHLIST.slice(0, 60)) {
    const c = await fetchCandles(item.symbol, { timeframe: "min1" });
    const p = detectPattern(c);
    if (!p || p.bias === "neutral") continue;
    const s = scorePattern(p, c);
    if (!byPattern.has(p.name)) byPattern.set(p.name, new Set());
    byPattern.get(p.name).add(s);
  }
  const varied = [...byPattern.values()].some((set) => set.size >= 2);
  assert.ok(varied, "expected strength to differ across instances of a pattern");
});

test("suggestedAction maps bias to Buy/Sell/Hold", () => {
  assert.equal(suggestedAction("bullish"), "Buy");
  assert.equal(suggestedAction("bearish"), "Sell");
  assert.equal(suggestedAction("neutral"), "Hold");
  assert.equal(suggestedAction("nonsense"), "—");
});
