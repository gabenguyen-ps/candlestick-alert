/*
 * Twelve Data provider — live candles from https://twelvedata.com.
 *
 * Uses the global `fetch` (browsers + Node 18+), so this module can back both
 * the web app and a future scheduled scanner.
 *
 * Provider interface:
 *   fetchCandles(symbol, { timeframe, apiKey }) -> Promise<Candle[]>  (newest-first)
 *   fetchSeries(symbol,  { timeframe, apiKey }) -> Promise<Candle[]>  (oldest-first)
 */
import { TIMEFRAMES } from "../config/timeframes.js";

const BASE_URL = "https://api.twelvedata.com/time_series";

// Twelve Data has no native 2-minute interval, so build it from 1-minute bars.
const AGGREGATION = { "2min": { source: "1min", factor: 2 } };

// Raw call; returns candles newest-first.
async function timeSeries(symbol, interval, outputsize, apiKey) {
  if (!apiKey) throw new Error("No API key set");

  const url =
    `${BASE_URL}?symbol=${encodeURIComponent(symbol)}` +
    `&interval=${encodeURIComponent(interval)}` +
    `&outputsize=${outputsize}&apikey=${encodeURIComponent(apiKey)}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();

  if (data.status === "error") throw new Error(data.message || "API error");
  if (!Array.isArray(data.values)) throw new Error("Unexpected response");

  return data.values.map((v) => ({
    datetime: v.datetime,
    open: parseFloat(v.open),
    high: parseFloat(v.high),
    low: parseFloat(v.low),
    close: parseFloat(v.close),
  }));
}

// Combine every `factor` consecutive candles (oldest-first) into one bar.
function aggregate(oldestFirst, factor) {
  const out = [];
  for (let i = 0; i < oldestFirst.length; i += factor) {
    const g = oldestFirst.slice(i, i + factor);
    if (!g.length) break;
    out.push({
      datetime: g[0].datetime,
      open: g[0].open,
      high: Math.max(...g.map((c) => c.high)),
      low: Math.min(...g.map((c) => c.low)),
      close: g[g.length - 1].close,
    });
  }
  return out;
}

// Candles for a timeframe, newest-first, ~count bars (handles 2-min aggregation).
async function candlesForTimeframe(symbol, tf, count, apiKey) {
  const agg = AGGREGATION[tf.interval];
  if (agg) {
    const raw = await timeSeries(symbol, agg.source, count * agg.factor, apiKey); // newest-first
    return aggregate(raw.slice().reverse(), agg.factor).reverse(); // back to newest-first
  }
  return timeSeries(symbol, tf.interval, count, apiKey);
}

// Latest candles at the scan timeframe, for pattern detection (newest-first).
export async function fetchCandles(symbol, { timeframe, apiKey } = {}) {
  const tf = TIMEFRAMES[timeframe] || TIMEFRAMES.daily;
  return candlesForTimeframe(symbol, tf, 5, apiKey);
}

// A charting series for a timeframe (oldest-first for left-to-right rendering).
export async function fetchSeries(symbol, { timeframe, apiKey } = {}) {
  const tf = TIMEFRAMES[timeframe] || TIMEFRAMES.daily;
  const newestFirst = await candlesForTimeframe(symbol, tf, tf.outputsize, apiKey);
  return newestFirst.slice().reverse();
}
