/*
 * Chart timeframes, geared toward day trading — intraday intervals plus a daily
 * view for context. Each shows ~90 candles.
 *
 * Note: Twelve Data has no native 2-minute interval, so the live provider builds
 * it by aggregating 1-minute bars (see providers/twelvedata.js). Demo mode
 * generates synthetic candles for every interval.
 */
export const TIMEFRAMES = {
  min1: { label: "1 min", interval: "1min", outputsize: 90 },
  min2: { label: "2 min", interval: "2min", outputsize: 90 },
  min5: { label: "5 min", interval: "5min", outputsize: 90 },
  min15: { label: "15 min", interval: "15min", outputsize: 90 },
  hour1: { label: "1 hour", interval: "1h", outputsize: 90 },
  daily: { label: "Daily", interval: "1day", outputsize: 90 },
};

// Default scan/chart timeframe (day-trading oriented).
export const DEFAULT_TIMEFRAME = "min1";
