# 🕯️ Candlestick Alert — S&P 500

A tiny, dependency-free web app that watches the candlesticks of the **entire
S&P 500** on a **selectable timeframe** (1m / 2m / 5m / 15m / 1h / Daily) and
fires a **browser notification** whenever a supported reversal pattern is detected
on that timeframe. The table is **searchable** and **paginated** (25 per page),
and it **auto-scans** the visible page continuously. The Signal column reports
whichever pattern the latest scan found (green = bullish, red = bearish), and the
Action column translates that into a suggested **Buy / Sell / Hold** — bullish →
Buy, bearish → Sell, and a Doji or no meaningful signal → Hold (the conservative
default). Educational only — not financial advice.

No backend, no build step — just static HTML/CSS and native ES modules. Runs
locally or on GitHub Pages.

## Project structure

The code is split into small, dependency-free ES modules so it's easy to extend
(more data sources, more notification channels) and so the detection logic can be
reused outside the browser — e.g. by a future scheduled GitHub Action.

```
candlestick-alert/
├── index.html                  UI markup
├── styles.css                  styling
├── package.json                {"type":"module"} + npm scripts (no dependencies)
├── src/
│   ├── config/watchlist.js     the tickers (edit here)
│   ├── config/timeframes.js    chart timeframes (Day/Week/Year)
│   ├── core/patterns.js        pure pattern detectors ← the portable core
│   ├── core/alert.js           format an alert into { title, body }
│   ├── providers/demo.js       fake data source (fetchCandles + fetchSeries)
│   ├── providers/twelvedata.js live data source (same interface)
│   ├── notifiers/browser.js    delivery sink (interface: sendNotification)
│   ├── ui/chart.js             SVG candlestick chart renderer
│   └── app.js                  browser wiring only (DOM, settings, scan loop)
└── tests/patterns.test.mjs     tests for the core (run with `npm test`)
```

**Extension points:**
- Add a data source → new file in `providers/` exporting `fetchCandles(symbol, opts)`.
- Add a notification channel (Slack, email) → new file in `notifiers/` exporting
  `sendNotification({ title, body })`.
- `core/` never imports from the browser or Node, so it drops straight into a
  server-side scanner unchanged.

## Watchlist

All ~500 S&P 500 constituents live in `src/config/watchlist.js` (generated from
the public S&P 500 constituents dataset — refresh periodically as the index
changes). Use the **search box** to filter by ticker or company name, and the
**Prev/Next** controls to page through 25 at a time.

Two tabs sit above the table:

- **All** — every S&P 500 ticker (the default view).
- **My Watchlist** — only the tickers you've pinned. Click the **＋** button on any
  row to add it (it turns into a **✓**); click again to remove. Your picks persist
  in `localStorage`.

The table also shows a **Strength** column: a **0–100 score** plus a **5-segment
mini bar** measuring how *decisively* a signal meets (and exceeds) its pattern
definition — e.g. a large, deeply-engulfing candle scores higher than a marginal
one. The score is computed from candle geometry (normalized by recent range) and
varies per instance, not per pattern type. The 5-segment bar is colored by how
many segments are lit: **0–1 red** (weak), **2–3 yellow** (moderate), **4–5 green**
(strong). Doji / no-signal rows show a gray dash.

## The patterns

Evaluated on the most-recent candles of the **selected scan timeframe** (`prev2` =
oldest, `prev` = middle, `cur` = latest). Detection runs in priority order —
three-candle patterns first (most specific), then two-candle, then single-candle.

**Three-candle patterns** (checked first):

| Pattern | Bias | Rule |
|---|---|---|
| **Morning Star** | 🟢 Bullish | big bearish candle → small "star" → big bullish candle closing into the first body |
| **Evening Star** | 🔴 Bearish | mirror of Morning Star |
| **Three White Soldiers** | 🟢 Bullish | three bullish candles with rising opens and closes |
| **Three Black Crows** | 🔴 Bearish | three bearish candles with falling opens and closes |

**Two-candle patterns:**

| Pattern | Bias | Rule |
|---|---|---|
| **Bullish Engulfing** | 🟢 Bullish | prev bearish; cur bullish; cur body engulfs prev body |
| **Bearish Engulfing** | 🔴 Bearish | prev bullish; cur bearish; cur body engulfs prev body |
| **Piercing Line** | 🟢 Bullish | prev bearish; cur bullish opens below prev close, closes above prev's midpoint (but below prev open) |
| **Dark Cloud Cover** | 🔴 Bearish | prev bullish; cur bearish opens above prev close, closes below prev's midpoint (but above prev open) |
| **Bullish Harami** | 🟢 Bullish | large prev bearish body; small bullish cur contained within it |
| **Bearish Harami** | 🔴 Bearish | large prev bullish body; small bearish cur contained within it |
| **Tweezer Bottom** | 🟢 Bullish | down candle then up candle sharing (near-)equal lows |
| **Tweezer Top** | 🔴 Bearish | up candle then down candle sharing (near-)equal highs |

**Single-candle patterns** (look at `cur`'s shape; some use `prev`'s direction as a
lightweight trend proxy):

| Pattern | Bias | Rule |
|---|---|---|
| **Dragonfly Doji** | 🟢 Bullish | doji body with a long lower wick, virtually no upper |
| **Gravestone Doji** | 🔴 Bearish | doji body with a long upper wick, virtually no lower |
| **Doji** | 🟡 Neutral | body ≤ 10% of the day's range (open ≈ close) |
| **Bullish Marubozu** | 🟢 Bullish | green candle; body ≥ 90% of range (little/no wick) |
| **Bearish Marubozu** | 🔴 Bearish | red candle; body ≥ 90% of range (little/no wick) |
| **Hammer** | 🟢 Bullish | small body up top, lower wick ≥ 2× body, tiny upper wick, after a down candle |
| **Hanging Man** | 🔴 Bearish | same shape as Hammer but after an up candle |
| **Inverted Hammer** | 🟢 Bullish | small body at bottom, upper wick ≥ 2× body, tiny lower wick, after a down candle |
| **Shooting Star** | 🔴 Bearish | same shape as Inverted Hammer but after an up candle |
| **Spinning Top** | 🟡 Neutral | small body with meaningful wicks on both sides (indecision) |

If more than one could match, the pattern higher in the priority order wins
(three-candle before two-candle before single-candle).

> Inverted Hammer and Shooting Star are the *same shape* — the only difference is
> trend. With just two candles available, the app uses the prior candle's
> direction as a simple trend proxy to tell them apart.

## Running locally

Because browsers block `fetch`/notifications on `file://`, serve the folder over HTTP:

```bash
# from inside candlestick-alert/
python3 -m http.server 8000
# then open http://localhost:8000
```

Any static server works (`npx serve`, VS Code Live Server, etc.). A server is
required because ES modules don't load over `file://`.

### Running the tests

The detection core has tests that run on Node's built-in test runner — no
dependencies to install:

```bash
npm test
```

### Demo mode (default)

The app starts in **demo mode** with generated candles — it works immediately, no
API key required. The demo generates **one scenario per pattern** (all 22, plus a
"no signal" case), spread across the tickers and timeframes, so every signal type
appears somewhere and the signal filters always have something to show.

The app **auto-scans the visible page every minute** (and immediately on any tab /
search / page / timeframe change), so signals stay fresh with no buttons to press.

### Live mode

1. Grab a free API key from **[Twelve Data](https://twelvedata.com/pricing)**
   (the free tier is CORS-enabled and works straight from the browser).
2. Untick **Demo mode** and paste your key.

> The free tier allows ~8 requests/minute, so scanning is limited to the visible
> page (25 tickers) and paced out. Your key is stored only in your browser's
> `localStorage` and is never sent anywhere except Twelve Data.

Alerts are de-duplicated per ticker per candle date, so you won't get spammed for
the same signal on repeated scans.

### Settings (⚙️)

The cog in the top-right opens a settings panel with collapsible categories:

- **Notifications**
  - **Web browser** — toggle on/off (functional; permission requested when
    enabled). Alerts always appear in the activity log regardless.
  - **Slack / Discord / Email** — placeholders for future channels (wired for
    later via the `notifiers/` interface).
- **Signal filters** — a checkbox per pattern (plus "No signal"). Uncheck patterns
  to hide them; the table then shows only the checked signal types. **Select all**
  / **Deselect all** toggle every checkbox at once.

Hover any **signal badge** (or a filter checkbox) for a plain-language description
of that pattern. The activity log shows 10 rows by default, expandable with
"Show more".

### Scan timeframe

The **"Detect patterns on"** dropdown picks the timeframe the scan runs on
(1 min / 2 min / 5 min / 15 min / 1 hour / Daily). Detection runs on that
timeframe's candles, so a ticker's signal can differ from one timeframe to the
next. Changing it re-scans immediately.

(Twelve Data has no native 2-minute interval, so live mode builds it by
aggregating 1-minute bars.)

### Charts

Click any **company name or ticker** to open a candlestick chart (rendered as
dependency-free inline SVG) with **date axis labels** and a **hover tooltip**
showing each candle's date + O/H/L/C. The six timeframe buttons match the scan
options, and the chart opens on the current scan timeframe.

**Highlighting:** the chart opens on the current scan timeframe and highlights the
detected pattern's candles (colored by bias). Switch timeframe buttons to see how
the pattern picture changes across timeframes.

## Deploying to GitHub Pages

1. Push this folder to a GitHub repo (see below).
2. In the repo: **Settings → Pages → Build and deployment → Source: Deploy from a
   branch**, pick `main` / `/root`, save.
3. Your app goes live at `https://<you>.github.io/<repo>/`.

## Disclaimer

Educational project. Not financial advice. Market data may be delayed and pattern
detection is simplistic by design.
