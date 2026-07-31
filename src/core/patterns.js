/*
 * Candlestick pattern detectors — the pure, portable core of the app.
 *
 * This module has NO dependency on the browser or Node: it only does math on
 * candle objects of the shape { datetime, open, high, low, close }. That's what
 * lets the same code run in the browser today and in a GitHub Action later.
 *
 * Candles are passed newest-first:
 *   candles[0] = latest ("cur"), candles[1] = prior ("prev").
 */

// ---- Two-candle patterns -------------------------------------------------
export function isBullishEngulfing(cur, prev) {
  return prev.close < prev.open && cur.close > cur.open &&
    cur.open <= prev.close && cur.close >= prev.open;
}

export function isBearishEngulfing(cur, prev) {
  return prev.close > prev.open && cur.close < cur.open &&
    cur.open >= prev.close && cur.close <= prev.open;
}

export function isPiercingLine(cur, prev) {
  const midpoint = (prev.open + prev.close) / 2;
  return prev.close < prev.open && cur.close > cur.open &&
    cur.open < prev.close && cur.close > midpoint && cur.close < prev.open;
}

export function isDarkCloudCover(cur, prev) {
  const midpoint = (prev.open + prev.close) / 2;
  return prev.close > prev.open && cur.close < cur.open &&
    cur.open > prev.close && cur.close < midpoint && cur.close > prev.open;
}

// ---- Single-candle geometry ----------------------------------------------
/*
 *   body       = |close - open|          (how far price actually moved)
 *   range      = high - low              (full extent incl. wicks)
 *   upperWick  = high - max(open, close)
 *   lowerWick  = min(open, close) - low
 */
export function geometry(c) {
  const body = Math.abs(c.close - c.open);
  const range = c.high - c.low;
  const upperWick = c.high - Math.max(c.open, c.close);
  const lowerWick = Math.min(c.open, c.close) - c.low;
  return { body, range, upperWick, lowerWick };
}

// Doji — open ≈ close: the body is tiny relative to the day's range.
export function isDoji(cur) {
  const { body, range } = geometry(cur);
  return range > 0 && body <= 0.1 * range;
}

// Marubozu — body fills almost the whole range (little to no wick).
export function isBullishMarubozu(cur) {
  const { body, range } = geometry(cur);
  return range > 0 && cur.close > cur.open && body >= 0.9 * range;
}
export function isBearishMarubozu(cur) {
  const { body, range } = geometry(cur);
  return range > 0 && cur.close < cur.open && body >= 0.9 * range;
}

// Hammer — small body up top, long lower wick, after a down candle (bullish).
export function isHammer(cur, prev) {
  const { body, upperWick, lowerWick } = geometry(cur);
  return body > 0 && lowerWick >= 2 * body && upperWick <= body &&
    prev.close < prev.open; // preceding down-move
}

// Inverted Hammer — small body at bottom, long upper wick, after a down candle (bullish).
export function isInvertedHammer(cur, prev) {
  const { body, upperWick, lowerWick } = geometry(cur);
  return body > 0 && upperWick >= 2 * body && lowerWick <= body &&
    prev.close < prev.open; // preceding down-move
}

// Shooting Star — same shape as Inverted Hammer but after an up candle (bearish).
export function isShootingStar(cur, prev) {
  const { body, upperWick, lowerWick } = geometry(cur);
  return body > 0 && upperWick >= 2 * body && lowerWick <= body &&
    prev.close > prev.open; // preceding up-move
}

// ---- Three-candle patterns -----------------------------------------------
/*
 * These need the three most-recent candles: cur (newest), prev, prev2 (oldest).
 * They return false when prev2 is missing, so they're safe on short histories.
 */
export function isMorningStar(cur, prev, prev2) {
  if (!prev2) return false;
  const firstBody = geometry(prev2).body;
  const starBody = geometry(prev).body;
  const firstMid = (prev2.open + prev2.close) / 2;
  return prev2.close < prev2.open && // first candle bearish
    starBody <= 0.5 * firstBody && // small "star" in the middle
    cur.close > cur.open && // third candle bullish
    cur.close > firstMid; // closes well into the first body
}

export function isEveningStar(cur, prev, prev2) {
  if (!prev2) return false;
  const firstBody = geometry(prev2).body;
  const starBody = geometry(prev).body;
  const firstMid = (prev2.open + prev2.close) / 2;
  return prev2.close > prev2.open && // first candle bullish
    starBody <= 0.5 * firstBody && // small "star"
    cur.close < cur.open && // third candle bearish
    cur.close < firstMid; // closes well into the first body
}

export function isThreeWhiteSoldiers(cur, prev, prev2) {
  if (!prev2) return false;
  const bullish = (c) => c.close > c.open;
  return bullish(prev2) && bullish(prev) && bullish(cur) &&
    cur.close > prev.close && prev.close > prev2.close && // rising closes
    cur.open > prev.open && prev.open > prev2.open; // rising opens
}

export function isThreeBlackCrows(cur, prev, prev2) {
  if (!prev2) return false;
  const bearish = (c) => c.close < c.open;
  return bearish(prev2) && bearish(prev) && bearish(cur) &&
    cur.close < prev.close && prev.close < prev2.close && // falling closes
    cur.open < prev.open && prev.open < prev2.open; // falling opens
}

// Hanging Man — same shape as a Hammer but after an up candle (bearish).
export function isHangingMan(cur, prev) {
  const { body, upperWick, lowerWick } = geometry(cur);
  return body > 0 && lowerWick >= 2 * body && upperWick <= body &&
    prev.close > prev.open; // preceding up-move
}

// ---- Harami: a small candle contained within the prior large body ---------
function isHarami(cur, prev, bullish) {
  const prevBody = Math.abs(prev.close - prev.open);
  const curBody = Math.abs(cur.close - cur.open);
  const curRange = cur.high - cur.low;
  const curHi = Math.max(cur.open, cur.close);
  const curLo = Math.min(cur.open, cur.close);
  const prevHi = Math.max(prev.open, prev.close);
  const prevLo = Math.min(prev.open, prev.close);
  const inside = curLo >= prevLo && curHi <= prevHi; // cur body within prev body
  const smallCur = curBody < prevBody * 0.6 && curRange < (prev.high - prev.low) * 0.6;
  const realCur = curBody > 0.1 * (curRange || 1e-9); // not a doji (that's a Harami Cross)
  const dirOK = bullish ? prev.close < prev.open && cur.close > cur.open
                        : prev.close > prev.open && cur.close < cur.open;
  return dirOK && inside && smallCur && realCur;
}
export function isBullishHarami(cur, prev) {
  return isHarami(cur, prev, true);
}
export function isBearishHarami(cur, prev) {
  return isHarami(cur, prev, false);
}

// ---- Tweezers: a reversal pair sharing a low (bottom) or high (top) --------
function tweezerTol(prev) {
  return 0.05 * (prev.high - prev.low || 1);
}
function realBody(c) {
  return Math.abs(c.close - c.open) > 0.1 * ((c.high - c.low) || 1e-9);
}
export function isTweezerBottom(cur, prev) {
  return prev.close < prev.open && cur.close > cur.open && // down then up
    Math.abs(cur.low - prev.low) <= tweezerTol(prev) && // matching lows
    realBody(cur) && realBody(prev);
}
export function isTweezerTop(cur, prev) {
  return prev.close > prev.open && cur.close < cur.open && // up then down
    Math.abs(cur.high - prev.high) <= tweezerTol(prev) && // matching highs
    realBody(cur) && realBody(prev);
}

// ---- Doji variants + Spinning Top (single-candle) -------------------------
// Dragonfly Doji — doji with a long lower wick and virtually no upper (bullish).
export function isDragonflyDoji(cur) {
  const { body, range, upperWick, lowerWick } = geometry(cur);
  return range > 0 && body <= 0.1 * range && lowerWick >= 0.6 * range && upperWick <= 0.1 * range;
}
// Gravestone Doji — doji with a long upper wick and virtually no lower (bearish).
export function isGravestoneDoji(cur) {
  const { body, range, upperWick, lowerWick } = geometry(cur);
  return range > 0 && body <= 0.1 * range && upperWick >= 0.6 * range && lowerWick <= 0.1 * range;
}
// Spinning Top — small body with meaningful wicks on both sides (indecision).
export function isSpinningTop(cur) {
  const { body, range, upperWick, lowerWick } = geometry(cur);
  return range > 0 && body > 0.1 * range && body <= 0.35 * range &&
    upperWick >= body && lowerWick >= body;
}

// ---- Registry ------------------------------------------------------------
// Ordered by specificity so the strongest signal wins on overlap: three-candle
// patterns first, then two-candle, then single-candle. Each test receives
// (cur, prev, prev2); detectors ignore arguments they don't need.
// `candles` = how many candles form the pattern (used to highlight it on a chart).
export const PATTERNS = [
  { name: "Morning Star", bias: "bullish", candles: 3, test: isMorningStar },
  { name: "Evening Star", bias: "bearish", candles: 3, test: isEveningStar },
  { name: "Three White Soldiers", bias: "bullish", candles: 3, test: isThreeWhiteSoldiers },
  { name: "Three Black Crows", bias: "bearish", candles: 3, test: isThreeBlackCrows },
  { name: "Bullish Engulfing", bias: "bullish", candles: 2, test: isBullishEngulfing },
  { name: "Bearish Engulfing", bias: "bearish", candles: 2, test: isBearishEngulfing },
  { name: "Piercing Line", bias: "bullish", candles: 2, test: isPiercingLine },
  { name: "Dark Cloud Cover", bias: "bearish", candles: 2, test: isDarkCloudCover },
  { name: "Bullish Harami", bias: "bullish", candles: 2, test: isBullishHarami },
  { name: "Bearish Harami", bias: "bearish", candles: 2, test: isBearishHarami },
  { name: "Tweezer Bottom", bias: "bullish", candles: 2, test: isTweezerBottom },
  { name: "Tweezer Top", bias: "bearish", candles: 2, test: isTweezerTop },
  { name: "Dragonfly Doji", bias: "bullish", candles: 1, test: isDragonflyDoji },
  { name: "Gravestone Doji", bias: "bearish", candles: 1, test: isGravestoneDoji },
  { name: "Doji", bias: "neutral", candles: 1, test: isDoji },
  { name: "Bullish Marubozu", bias: "bullish", candles: 1, test: isBullishMarubozu },
  { name: "Bearish Marubozu", bias: "bearish", candles: 1, test: isBearishMarubozu },
  { name: "Hammer", bias: "bullish", candles: 1, test: isHammer },
  { name: "Hanging Man", bias: "bearish", candles: 1, test: isHangingMan },
  { name: "Inverted Hammer", bias: "bullish", candles: 1, test: isInvertedHammer },
  { name: "Shooting Star", bias: "bearish", candles: 1, test: isShootingStar },
  { name: "Spinning Top", bias: "neutral", candles: 1, test: isSpinningTop },
];

// Returns the first matching pattern { name, bias } or null.
export function detectPattern(candles) {
  if (!candles || candles.length < 2) return null;
  const [cur, prev, prev2] = candles;
  return PATTERNS.find((p) => p.test(cur, prev, prev2)) || null;
}

/*
 * Scans an oldest-first series and returns every (non-overlapping) pattern
 * occurrence: [{ start, end, name, bias, candles }] where start/end index into
 * the series. Used to highlight patterns on a chart at whatever timeframe it
 * shows — a pattern is a pattern on 5-minute candles just as on daily ones.
 */
export function findPatterns(series) {
  if (!series || series.length < 2) return [];
  const out = [];
  let i = series.length - 1;
  while (i >= 1) {
    // Window is newest-first: [cur, prev, prev2]; prev2 may be undefined at i=1.
    const p = detectPattern([series[i], series[i - 1], series[i - 2]]);
    if (p) {
      const start = Math.max(0, i - (p.candles - 1));
      out.push({ start, end: i, name: p.name, bias: p.bias, candles: p.candles });
      i = start - 1; // skip past this pattern so bands don't overlap
    } else {
      i -= 1;
    }
  }
  return out.reverse(); // oldest-first
}

// Maps a pattern's bias to a suggested action. Shared by the UI and any
// future notifier (Slack/email) so the wording stays consistent.
const ACTIONS = { bullish: "Buy", bearish: "Sell", neutral: "Hold" };
export function suggestedAction(bias) {
  return ACTIONS[bias] ?? "—";
}

/*
 * Signal strength (0–100) — how decisively a detected pattern meets (and exceeds)
 * its definition, normalized by the recent average candle range so it's
 * comparable across price levels. Price-only (no volume), so demo and live agree.
 * Neutral patterns (Doji) have no directional strength → null.
 */
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const to100 = (x) => clamp01(x) * 100;
const bodyOf = (c) => Math.abs(c.close - c.open);

function avgRange(candles) {
  const rs = candles.map((c) => c.high - c.low).filter((r) => Number.isFinite(r) && r > 0);
  return rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : 1;
}

function engulfStrength(cur, prev, ctx) {
  const b = bodyOf(cur), pb = bodyOf(prev);
  const bodyScore = clamp01(b / (ctx.avgRange * 1.5)); // decisive confirming candle
  const engScore = clamp01(b / (pb || 1e-9) - 1); // how much it exceeds the prior body
  const wickBonus = cur.high >= prev.high && cur.low <= prev.low ? 0.15 : 0; // engulfs wicks too
  return to100(0.55 * bodyScore + 0.45 * engScore + wickBonus);
}

function piercingStrength(cur, prev, ctx, bullish) {
  const bodyScore = clamp01(bodyOf(cur) / (ctx.avgRange * 1.5));
  const pen = bullish
    ? (cur.close - prev.close) / ((prev.open - prev.close) || 1e-9)
    : (prev.close - cur.close) / ((prev.close - prev.open) || 1e-9);
  const penScore = clamp01((pen - 0.5) / 0.5); // 0 at midpoint (minimum), 1 at full recovery
  return to100(0.5 * bodyScore + 0.5 * penScore);
}

function wickStrength(cur, which) {
  const g = geometry(cur);
  const longW = which === "lower" ? g.lowerWick : g.upperWick;
  const oppW = which === "lower" ? g.upperWick : g.lowerWick;
  const ratio = longW / (g.body || 1e-9);
  const wickScore = clamp01((ratio - 2) / 4 + 0.35); // beyond the 2× minimum
  const cleanScore = clamp01(1 - oppW / (g.body || 1e-9)); // small opposite wick
  return to100(0.6 * wickScore + 0.4 * cleanScore);
}

function marubozuStrength(cur, ctx) {
  const g = geometry(cur);
  const ratioScore = clamp01((g.body / (g.range || 1e-9) - 0.9) / 0.1);
  const sizeScore = clamp01(g.body / (ctx.avgRange * 1.5));
  return to100(0.5 * ratioScore + 0.5 * sizeScore);
}

function starStrength(cur, prev, prev2, ctx, bullish) {
  const firstBody = bodyOf(prev2), starBody = bodyOf(prev), thirdBody = bodyOf(cur);
  const thirdScore = clamp01(thirdBody / (ctx.avgRange * 1.5));
  const firstMid = (prev2.open + prev2.close) / 2;
  const depth = bullish
    ? (cur.close - firstMid) / ((prev2.open - firstMid) || 1e-9)
    : (firstMid - cur.close) / ((firstMid - prev2.open) || 1e-9);
  const smallStar = clamp01(1 - starBody / (firstBody || 1e-9));
  return to100(0.4 * thirdScore + 0.35 * clamp01(depth) + 0.25 * smallStar);
}

function tripleStrength(cur, prev, prev2, ctx) {
  const cs = [cur, prev, prev2];
  const bodies = cs.map(bodyOf);
  const mean = (bodies[0] + bodies[1] + bodies[2]) / 3;
  const sizeScore = clamp01(mean / ctx.avgRange);
  // Fullness: how much of each candle's range is body (little wick = decisive).
  const fullness = cs.reduce((a, c) => a + bodyOf(c) / ((c.high - c.low) || 1e-9), 0) / 3;
  return to100(0.5 * sizeScore + 0.5 * clamp01(fullness));
}

// Harami: smaller inner candle + larger prior body = stronger.
function haramiStrength(cur, prev, ctx) {
  const containment = clamp01(1 - bodyOf(cur) / (bodyOf(prev) || 1e-9));
  const priorSize = clamp01(bodyOf(prev) / (ctx.avgRange * 1.5));
  return to100(0.5 * containment + 0.5 * priorSize);
}

// Tweezer: closer matching low/high + bigger bodies = stronger.
function tweezerStrength(cur, prev, ctx, bottom) {
  const tol = 0.05 * ((prev.high - prev.low) || 1);
  const diff = bottom ? Math.abs(cur.low - prev.low) : Math.abs(cur.high - prev.high);
  const closeness = clamp01(1 - diff / (tol || 1e-9));
  const bodySize = clamp01((bodyOf(cur) + bodyOf(prev)) / (2 * ctx.avgRange));
  return to100(0.5 * closeness + 0.5 * bodySize);
}

// Doji variants: longer defining wick relative to range = stronger.
function dojiWickStrength(cur, which) {
  const g = geometry(cur);
  const longW = which === "lower" ? g.lowerWick : g.upperWick;
  return to100(clamp01((longW / (g.range || 1e-9) - 0.6) / 0.4));
}

const STRENGTH = {
  "Bullish Engulfing": (c, p, _p2, ctx) => engulfStrength(c, p, ctx),
  "Bearish Engulfing": (c, p, _p2, ctx) => engulfStrength(c, p, ctx),
  "Piercing Line": (c, p, _p2, ctx) => piercingStrength(c, p, ctx, true),
  "Dark Cloud Cover": (c, p, _p2, ctx) => piercingStrength(c, p, ctx, false),
  Hammer: (c) => wickStrength(c, "lower"),
  "Inverted Hammer": (c) => wickStrength(c, "upper"),
  "Shooting Star": (c) => wickStrength(c, "upper"),
  "Bullish Marubozu": (c, _p, _p2, ctx) => marubozuStrength(c, ctx),
  "Bearish Marubozu": (c, _p, _p2, ctx) => marubozuStrength(c, ctx),
  "Morning Star": (c, p, p2, ctx) => starStrength(c, p, p2, ctx, true),
  "Evening Star": (c, p, p2, ctx) => starStrength(c, p, p2, ctx, false),
  "Three White Soldiers": (c, p, p2, ctx) => tripleStrength(c, p, p2, ctx),
  "Three Black Crows": (c, p, p2, ctx) => tripleStrength(c, p, p2, ctx),
  "Hanging Man": (c) => wickStrength(c, "lower"),
  "Bullish Harami": (c, p, _p2, ctx) => haramiStrength(c, p, ctx),
  "Bearish Harami": (c, p, _p2, ctx) => haramiStrength(c, p, ctx),
  "Tweezer Bottom": (c, p, _p2, ctx) => tweezerStrength(c, p, ctx, true),
  "Tweezer Top": (c, p, _p2, ctx) => tweezerStrength(c, p, ctx, false),
  "Dragonfly Doji": (c) => dojiWickStrength(c, "lower"),
  "Gravestone Doji": (c) => dojiWickStrength(c, "upper"),
  // Doji and Spinning Top are neutral — no directional strength.
};

// Plain-language, one-line descriptions for the signal tooltips.
const DESCRIPTIONS = {
  "Morning Star": "Downtrend may be ending — could be a good time to buy.",
  "Evening Star": "Uptrend may be ending — could be a good time to sell.",
  "Three White Soldiers": "Three strong up days in a row — buyers are in control.",
  "Three Black Crows": "Three strong down days in a row — sellers are in control.",
  "Bullish Engulfing": "A big up day wipes out the prior down day — buyers taking over.",
  "Bearish Engulfing": "A big down day wipes out the prior up day — sellers taking over.",
  "Piercing Line": "Price bounced back up strongly after a down day — a bullish sign.",
  "Dark Cloud Cover": "Price dropped back down sharply after an up day — a bearish sign.",
  "Bullish Harami": "Selling is losing steam after a drop — price may turn up.",
  "Bearish Harami": "Buying is losing steam after a rally — price may turn down.",
  "Tweezer Bottom": "Price hit the same low twice and held — it may bounce up.",
  "Tweezer Top": "Price hit the same high twice and stalled — it may fall.",
  "Dragonfly Doji": "Sellers pushed price down but buyers pushed it all the way back — bullish.",
  "Gravestone Doji": "Buyers pushed price up but sellers pushed it all the way back — bearish.",
  Doji: "Buyers and sellers are evenly matched — no clear direction.",
  "Bullish Marubozu": "A strong all-green day — buyers dominated from open to close.",
  "Bearish Marubozu": "A strong all-red day — sellers dominated from open to close.",
  Hammer: "Price dropped then snapped back up — buyers stepped in (bullish).",
  "Hanging Man": "After a rally, buyers are slipping — price may turn down.",
  "Inverted Hammer": "After a drop, buyers are testing higher — price may turn up.",
  "Shooting Star": "After a rally, sellers pushed price back down — price may fall.",
  "Spinning Top": "A quiet, indecisive day — the trend may be pausing.",
};

export function describePattern(name) {
  return DESCRIPTIONS[name] || "";
}

// Strength (0–100) for a detected pattern given its candles (newest-first),
// or null for neutral / unscored patterns.
export function scorePattern(pattern, candles) {
  if (!pattern) return null;
  const fn = STRENGTH[pattern.name];
  if (!fn) return null;
  const [cur, prev, prev2] = candles;
  return Math.round(fn(cur, prev, prev2, { avgRange: avgRange(candles) }));
}
