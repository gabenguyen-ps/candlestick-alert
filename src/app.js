/*
 * Browser app — UI wiring only.
 *
 * All the reusable logic lives in dependency-free modules:
 *   core/patterns.js  — pattern detection (shared with any future scanner)
 *   core/alert.js     — alert message formatting
 *   providers/*       — data sources (demo / Twelve Data)
 *   notifiers/*       — delivery sinks (browser today; Slack/email later)
 *
 * This file handles the DOM, paging/search, and the auto-scan loop. With ~500
 * tickers, the scan runs on the currently visible page (25 rows) so it stays
 * fast in demo and feasible against the free API tier in live mode.
 */
import { WATCHLIST } from "./config/watchlist.js";
import { TIMEFRAMES, DEFAULT_TIMEFRAME } from "./config/timeframes.js";
import { PATTERNS, detectPattern, suggestedAction, findPatterns, scorePattern, describePattern } from "./core/patterns.js";
import { formatAlert } from "./core/alert.js";
import { fetchCandles as fetchDemo, fetchSeries as fetchDemoSeries, demoHighlight, demoPattern } from "./providers/demo.js";
import { fetchCandles as fetchTwelveData, fetchSeries as fetchTwelveSeries } from "./providers/twelvedata.js";
import * as browserNotifier from "./notifiers/browser.js";
import * as discordNotifier from "./notifiers/discord.js";
import { renderCandlestickChart } from "./ui/chart.js";

const PAGE_SIZE = 25;
const AUTO_SCAN_MS = 60000; // auto-scan the visible page every minute
const LIVE_PACING_MS = 8000; // spacing between live requests (free tier ~8/min)

const STORAGE_KEYS = {
  apiKey: "cba.apiKey",
  demo: "cba.demoMode",
  scanTf: "cba.scanTimeframe", // which timeframe patterns are detected on
  view: "cba.view", // "all" | "mine"
  watchlist: "cba.watchlist", // symbols the user pinned to My Watchlist
  notifyBrowser: "cba.notifyBrowser", // browser notifications on/off
  notifyDiscord: "cba.notifyDiscord", // discord notifications on/off
  discordWebhook: "cba.discordWebhook", // discord webhook URL (secret, browser-only)
  notifyWatchlist: "cba.notifyWatchlist", // alert on My Watchlist tickers (additive)
  watchlistTf: "cba.watchlistTf", // timeframe for the watchlist alert ("any" or a key)
  notifySpecific: "cba.notifySpecific", // alert on specific pattern rules
  notifyRules: "cba.notifyRules", // [{ pattern, timeframe }] alert rules
  filters: "cba.filters", // enabled signal-filter names
  notified: "cba.notified", // { "AAPL": { date, pattern }, ... } last alert per symbol
  log: "cba.log", // persisted activity log entries
};

// All selectable signal-filter names: every pattern plus a "no signal" bucket.
const ALL_FILTER_NAMES = [...PATTERNS.map((p) => p.name), "none"];

// ---- DOM references ------------------------------------------------------
const els = {
  scanTimeframe: document.getElementById("scan-timeframe"),
  demoToggle: document.getElementById("demo-toggle"),
  apiRow: document.getElementById("api-row"),
  apiKey: document.getElementById("apikey"),
  status: document.getElementById("status"),
  tbody: document.querySelector("#watchlist tbody"),
  viewTabs: document.getElementById("view-tabs"),
  mineCount: document.getElementById("mine-count"),
  search: document.getElementById("search"),
  resultsCount: document.getElementById("results-count"),
  prevPage: document.getElementById("prev-page"),
  nextPage: document.getElementById("next-page"),
  pageInfo: document.getElementById("page-info"),
  log: document.getElementById("log"),
  logToggle: document.getElementById("log-toggle"),
  // Settings modal
  settingsBtn: document.getElementById("settings-btn"),
  settingsModal: document.getElementById("settings-modal"),
  settingsClose: document.getElementById("settings-close"),
  notifyBrowser: document.getElementById("notify-browser"),
  notifyBrowserBadge: document.getElementById("notify-browser-badge"),
  notifyDiscord: document.getElementById("notify-discord"),
  notifyDiscordBadge: document.getElementById("notify-discord-badge"),
  discordConfig: document.getElementById("discord-config"),
  discordWebhook: document.getElementById("discord-webhook"),
  discordTest: document.getElementById("discord-test"),
  discordTestResult: document.getElementById("discord-test-result"),
  notifyWatchlist: document.getElementById("notify-watchlist"),
  watchlistConfig: document.getElementById("watchlist-config"),
  watchlistTf: document.getElementById("watchlist-tf"),
  notifySpecific: document.getElementById("notify-specific"),
  specificConfig: document.getElementById("specific-config"),
  rulesList: document.getElementById("rules-list"),
  addRule: document.getElementById("add-rule"),
  clearRules: document.getElementById("clear-rules"),
  filterList: document.getElementById("filter-list"),
  selectAllFilters: document.getElementById("select-all-filters"),
  deselectAllFilters: document.getElementById("deselect-all-filters"),
  // Chart modal
  modal: document.getElementById("chart-modal"),
  chartTitle: document.getElementById("chart-title"),
  chartClose: document.getElementById("chart-close"),
  timeframeRow: document.getElementById("timeframe-row"),
  chartContainer: document.getElementById("chart-container"),
  chartCaption: document.getElementById("chart-caption"),
};

let scanning = false;
let query = "";
let page = 0;
let view = "all"; // "all" | "mine"
let myWatchlist = new Set(); // symbols pinned to My Watchlist
let enabledFilters = new Set(ALL_FILTER_NAMES); // signal types shown in the table
let notifyRules = []; // [{ pattern, timeframe }] — a signal alerts if it matches any rule
const results = {}; // symbol -> { close, pattern, score } | { error } (current timeframe)

// Which symbol the chart modal is currently showing.
let chartSymbol = null;

// ---- Small helpers -------------------------------------------------------
const store = {
  get: (k, fallback) => {
    const v = localStorage.getItem(k);
    return v === null ? fallback : v;
  },
  set: (k, v) => localStorage.setItem(k, v),
  getJSON: (k, fallback) => {
    try {
      return JSON.parse(localStorage.getItem(k)) ?? fallback;
    } catch {
      return fallback;
    }
  },
  setJSON: (k, v) => localStorage.setItem(k, JSON.stringify(v)),
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function setStatus(msg) {
  els.status.textContent = msg;
}

let logEntries = []; // newest-first: { t, msg, hit }

function renderLog() {
  els.log.innerHTML = "";
  for (const e of logEntries) {
    const li = document.createElement("li");
    if (e.hit) li.className = "hit";
    const t = document.createElement("time");
    t.textContent = e.t;
    li.appendChild(t);
    li.appendChild(document.createTextNode(e.msg));
    els.log.appendChild(li);
  }
  updateLogToggle();
}

function log(msg, isHit = false) {
  logEntries.unshift({ t: new Date().toLocaleTimeString(), msg, hit: isHit });
  if (logEntries.length > 200) logEntries.length = 200; // cap
  store.setJSON(STORAGE_KEYS.log, logEntries);
  renderLog();
}

// The log shows 10 rows by default (via CSS); this toggles the rest.
function updateLogToggle() {
  const total = els.log.children.length;
  if (total <= 10) {
    els.logToggle.classList.add("hidden");
    return;
  }
  els.logToggle.classList.remove("hidden");
  els.logToggle.textContent = els.log.classList.contains("expanded")
    ? "Show less"
    : `Show more (${total - 10})`;
}

// ---- Paging + filtering --------------------------------------------------
const filtersActive = () => enabledFilters.size < ALL_FILTER_NAMES.length;

// The signal name a symbol currently shows ("none" for no pattern), or null when
// unknown (live mode, not yet scanned — such rows aren't hidden by the filter).
function patternNameOf(symbol) {
  if (isDemoMode()) {
    const p = demoPattern(symbol, scanTimeframe());
    return p ? p.name : "none";
  }
  const r = results[symbol];
  if (!r) return null;
  return r.pattern ? r.pattern.name : "none";
}

function filteredTickers() {
  let base = WATCHLIST;
  if (view === "mine") base = base.filter((w) => myWatchlist.has(w.symbol));
  if (query) {
    const q = query.toLowerCase();
    base = base.filter((w) => w.symbol.toLowerCase().includes(q) || w.name.toLowerCase().includes(q));
  }
  if (filtersActive()) {
    base = base.filter((w) => {
      const name = patternNameOf(w.symbol);
      return name === null || enabledFilters.has(name);
    });
  }
  return base;
}

function pageCount() {
  return Math.max(1, Math.ceil(filteredTickers().length / PAGE_SIZE));
}

function pageItems() {
  const start = page * PAGE_SIZE;
  return filteredTickers().slice(start, start + PAGE_SIZE);
}

// ---- Provider selection --------------------------------------------------
function isDemoMode() {
  return els.demoToggle.checked;
}

function scanTimeframe() {
  const tf = els.scanTimeframe.value;
  return TIMEFRAMES[tf] ? tf : DEFAULT_TIMEFRAME; // fall back if stale/invalid
}

// Returns a function (symbol) -> Promise<Candle[]> for the current mode,
// detecting on the selected scan timeframe.
function currentProvider() {
  const timeframe = scanTimeframe();
  if (isDemoMode()) return (symbol) => fetchDemo(symbol, { timeframe });
  const apiKey = els.apiKey.value.trim();
  return (symbol) => fetchTwelveData(symbol, { timeframe, apiKey });
}

// ---- Notifications -------------------------------------------------------
function alertFor(company, symbol, pattern, candle) {
  const { title, body } = formatAlert(company, symbol, pattern, candle);
  if (els.notifyBrowser.checked) browserNotifier.sendNotification({ title, body });
  if (els.notifyDiscord.checked && els.discordWebhook.value.trim()) {
    discordNotifier.sendNotification({ title, body }, els.discordWebhook.value.trim()); // fire-and-forget
  }
  log(`${title} — ${body}`, true); // always logged, regardless of channels
}

// Whether a detected signal should fire a notification. Two independent, additive
// triggers: My Watchlist (any pattern, chosen timeframe) and specific pattern
// rules (any ticker). A signal alerts if it matches EITHER. If neither trigger is
// enabled, alert on everything. (Separate from the table's signal filters.)
function shouldNotify(symbol, pattern) {
  const watchlistOn = els.notifyWatchlist.checked;
  const specificOn = els.notifySpecific.checked;
  if (!watchlistOn && !specificOn) return true; // default: alert on everything

  const tf = scanTimeframe();

  if (watchlistOn && myWatchlist.has(symbol)) {
    const wtf = els.watchlistTf.value;
    if (wtf === "any" || wtf === tf) return true;
  }
  if (specificOn) {
    const matches = notifyRules.some(
      (r) =>
        (r.pattern === "any" || r.pattern === pattern.name) &&
        (r.timeframe === "any" || r.timeframe === tf)
    );
    if (matches) return true;
  }
  return false;
}

// ---- Signal filters ------------------------------------------------------
function persistFilters() {
  store.setJSON(STORAGE_KEYS.filters, [...enabledFilters]);
}

function filterCheckbox(name, label = name) {
  const checked = enabledFilters.has(name) ? "checked" : "";
  const title = describePattern(name);
  return `<label class="filter-item" title="${title}"><input type="checkbox" data-filter="${name}" ${checked}/> <span>${label}</span></label>`;
}

function buildSignalFilters() {
  const groups = { bullish: [], bearish: [], neutral: [] };
  for (const p of PATTERNS) groups[p.bias].push(p.name);
  const labels = { bullish: "Bullish", bearish: "Bearish", neutral: "Neutral" };
  let html = "";
  for (const bias of ["bullish", "bearish", "neutral"]) {
    html += `<div class="filter-group"><div class="filter-group-title">${labels[bias]}</div>`;
    html += groups[bias].map((n) => filterCheckbox(n)).join("");
    if (bias === "neutral") html += filterCheckbox("none", "No signal"); // roll "No signal" into Neutral
    html += `</div>`;
  }
  els.filterList.innerHTML = html;
}

function setAllFilters(on) {
  enabledFilters = new Set(on ? ALL_FILTER_NAMES : []);
  persistFilters();
  buildSignalFilters();
  page = 0;
  refreshAndScan();
}

// ---- Notification rules --------------------------------------------------
function persistRules() {
  store.setJSON(STORAGE_KEYS.notifyRules, notifyRules);
}

function optionsHTML(items, selected) {
  return items
    .map((it) => `<option value="${it.value}"${it.value === selected ? " selected" : ""}>${it.label}</option>`)
    .join("");
}
function patternOptions() {
  return [{ value: "any", label: "Any pattern" }, ...PATTERNS.map((p) => ({ value: p.name, label: p.name }))];
}
function timeframeOptions() {
  return [{ value: "any", label: "Any timeframe" }, ...Object.entries(TIMEFRAMES).map(([k, tf]) => ({ value: k, label: tf.label }))];
}

function buildWatchlistTfOptions() {
  els.watchlistTf.innerHTML = optionsHTML(timeframeOptions(), els.watchlistTf.value || "any");
}

// Reveal the timeframe dropdown / rules list when their box is checked.
function updateWatchlistReveal() {
  els.watchlistConfig.classList.toggle("hidden", !els.notifyWatchlist.checked);
}
function updateSpecificReveal() {
  els.specificConfig.classList.toggle("hidden", !els.notifySpecific.checked);
  // On first enable, show one starter rule row.
  if (els.notifySpecific.checked && notifyRules.length === 0) {
    notifyRules.push({ pattern: "any", timeframe: "any" });
    persistRules();
    buildRulesList();
  }
}

function buildRulesList() {
  if (notifyRules.length === 0) {
    els.rulesList.innerHTML = `<p class="rules-empty">No rules — add one to target specific patterns.</p>`;
    return;
  }
  const patts = patternOptions();
  const tfs = timeframeOptions();
  els.rulesList.innerHTML = notifyRules
    .map(
      (r, i) => `
      <div class="rule-row" data-index="${i}">
        <select class="rule-pattern">${optionsHTML(patts, r.pattern)}</select>
        <select class="rule-timeframe">${optionsHTML(tfs, r.timeframe)}</select>
        <button class="rule-delete" title="Delete this rule" aria-label="Delete rule">✕</button>
      </div>`
    )
    .join("");
}

// De-dupe: only alert once per symbol per (candle date + pattern).
function alreadyNotified(symbol, candleDate, patternName) {
  const seen = store.getJSON(STORAGE_KEYS.notified, {})[symbol];
  return seen && seen.date === candleDate && seen.pattern === patternName;
}
function markNotified(symbol, candleDate, patternName) {
  const map = store.getJSON(STORAGE_KEYS.notified, {});
  map[symbol] = { date: candleDate, pattern: patternName };
  store.setJSON(STORAGE_KEYS.notified, map);
}

// ---- Rendering -----------------------------------------------------------
const SIGNAL_CLASS = { bullish: "signal-hit", bearish: "signal-bearish", neutral: "signal-neutral" };
const ACTION_CLASS = { bullish: "action-buy", bearish: "action-sell", neutral: "action-hold" };

function favButtonHTML(symbol) {
  const inList = myWatchlist.has(symbol);
  const cls = inList ? "fav-btn in" : "fav-btn";
  const label = inList ? "Remove from My Watchlist" : "Add to My Watchlist";
  return `<button class="${cls}" data-fav title="${label}" aria-label="${label}">${inList ? "✓" : "＋"}</button>`;
}

function renderRows() {
  page = Math.min(Math.max(0, page), pageCount() - 1); // stay in range
  els.tbody.innerHTML = "";
  const items = pageItems();

  if (items.length === 0) {
    const tr = document.createElement("tr");
    tr.className = "empty-row";
    tr.innerHTML = `<td colspan="7">${
      view === "mine"
        ? "No tickers in My Watchlist yet — add some with ＋ from the All tab."
        : "No tickers match your search or signal filters."
    }</td>`;
    els.tbody.appendChild(tr);
    renderPagination();
    return;
  }

  for (const item of items) {
    const tr = document.createElement("tr");
    tr.dataset.symbol = item.symbol;
    tr.innerHTML = `
      <td class="cell-fav">${favButtonHTML(item.symbol)}</td>
      <td class="clickable" data-chart>${item.name}</td>
      <td class="ticker clickable" data-chart>${item.symbol}</td>
      <td class="cell-close">—</td>
      <td class="cell-signal"><span class="signal-badge signal-pending">not scanned</span></td>
      <td class="cell-strength">—</td>
      <td class="cell-action">—</td>
    `;
    els.tbody.appendChild(tr);
    if (results[item.symbol]) updateRow(item.symbol, results[item.symbol]); // restore cached
  }
  renderPagination();
}

// ---- My Watchlist tabs ---------------------------------------------------
function persistWatchlist() {
  store.setJSON(STORAGE_KEYS.watchlist, [...myWatchlist]);
}

function updateTabs() {
  els.mineCount.textContent = String(myWatchlist.size);
  els.viewTabs.querySelectorAll(".tab").forEach((b) =>
    b.classList.toggle("active", b.dataset.view === view)
  );
}

function toggleFav(symbol) {
  if (myWatchlist.has(symbol)) myWatchlist.delete(symbol);
  else myWatchlist.add(symbol);
  persistWatchlist();
  updateTabs();
  renderRows(); // reflect membership (and drop removed rows on the "mine" tab)
}

function switchView(next) {
  if (view === next) return;
  view = next;
  page = 0;
  store.set(STORAGE_KEYS.view, view);
  updateTabs();
  refreshAndScan();
}

function renderPagination() {
  const total = filteredTickers().length;
  const pages = pageCount();
  els.pageInfo.textContent = `Page ${page + 1} of ${pages}`;
  els.prevPage.disabled = page <= 0;
  els.nextPage.disabled = page >= pages - 1;
  const from = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const to = Math.min(total, (page + 1) * PAGE_SIZE);
  els.resultsCount.textContent = `${from}–${to} of ${total} ticker(s)`;
}

// Renders the strength cell: numeric 0–100 + a 5-segment mini bar colored by how
// many bars are filled (0–1 red = weak, 2–3 yellow = moderate, 4–5 green =
// strong). Gray dash for neutral (Doji) / no signal.
function strengthCellHTML(pattern, score) {
  if (!pattern || pattern.bias === "neutral" || score == null) {
    return `<span class="strength-none">—</span>`;
  }
  const filled = Math.max(0, Math.min(5, Math.round(score / 20)));
  const tier = filled <= 1 ? "str-weak" : filled <= 3 ? "str-mid" : "str-strong";
  let bars = "";
  for (let i = 0; i < 5; i++) bars += `<span class="str-seg ${i < filled ? tier : "str-empty"}"></span>`;
  return `<span class="strength" title="${score}/100"><span class="str-score">${score}</span><span class="str-bars">${bars}</span></span>`;
}

function updateRow(symbol, { close, pattern, score, error } = {}) {
  const tr = els.tbody.querySelector(`tr[data-symbol="${CSS.escape(symbol)}"]`);
  if (!tr) return;
  const signalCell = tr.querySelector(".cell-signal");
  const strengthCell = tr.querySelector(".cell-strength");
  const actionCell = tr.querySelector(".cell-action");

  if (error) {
    signalCell.innerHTML = `<span class="signal-badge signal-error">${error}</span>`;
    strengthCell.innerHTML = "—";
    actionCell.innerHTML = "—";
  } else {
    tr.querySelector(".cell-close").textContent = close != null ? close.toFixed(2) : "—";
    strengthCell.innerHTML = strengthCellHTML(pattern, score);
    if (pattern) {
      signalCell.innerHTML = `<span class="signal-badge ${SIGNAL_CLASS[pattern.bias]}" title="${describePattern(pattern.name)}">${pattern.name}</span>`;
      actionCell.innerHTML = `<span class="action ${ACTION_CLASS[pattern.bias]}">${suggestedAction(pattern.bias)}</span>`;
    } else {
      // No meaningful signal → recommend the conservative default, Hold.
      signalCell.innerHTML = `<span class="signal-badge signal-none">none</span>`;
      actionCell.innerHTML = `<span class="action action-hold">Hold</span>`;
    }
  }
}

// ---- Scan orchestration --------------------------------------------------
// Scans the currently visible page of tickers.
async function scanVisible() {
  if (scanning) return;

  const demo = isDemoMode();
  if (!demo && !els.apiKey.value.trim()) {
    setStatus("Live mode needs a Twelve Data API key. Add one or switch to demo mode.");
    return;
  }

  scanning = true;
  const provider = currentProvider();
  const items = pageItems();
  const tfLabel = TIMEFRAMES[scanTimeframe()].label;
  setStatus(`Scanning ${items.length} tickers on the ${tfLabel} timeframe (${demo ? "demo" : "live"} mode)…`);
  let hits = 0;
  let buy = 0;
  let sell = 0;

  for (const item of items) {
    try {
      const candles = await provider(item.symbol);
      const latest = candles[0];
      const pattern = detectPattern(candles);
      const score = scorePattern(pattern, candles);
      results[item.symbol] = { close: latest.close, pattern, score };
      updateRow(item.symbol, results[item.symbol]);

      if (pattern && pattern.bias === "bullish") buy++;
      else if (pattern && pattern.bias === "bearish") sell++;

      if (pattern && shouldNotify(item.symbol, pattern) && !alreadyNotified(item.symbol, latest.datetime, pattern.name)) {
        alertFor(item.name, item.symbol, pattern, latest);
        markNotified(item.symbol, latest.datetime, pattern.name);
        hits++;
      }
    } catch (err) {
      results[item.symbol] = { error: err.message };
      updateRow(item.symbol, results[item.symbol]);
      log(`⚠️ ${item.symbol}: ${err.message}`);
    }
    if (!demo) await sleep(LIVE_PACING_MS); // pace the free API tier
  }

  // A concise summary so the log always shows activity — de-duped so a static
  // (unchanged) scan doesn't repeat the same line every minute.
  const summary = `${tfLabel}: ${buy} buy, ${sell} sell across ${items.length} tickers` +
    (hits ? ` — ${hits} new alert(s)` : "");
  if (logEntries[0]?.msg !== summary) log(summary);

  setStatus(`Scan complete at ${new Date().toLocaleTimeString()} — ${hits} new signal(s) on this page.`);
  scanning = false;
}

// Re-render the current page and scan it (used after paging/search/timeframe changes).
function refreshAndScan() {
  renderRows();
  scanVisible();
}

// ---- Chart modal ---------------------------------------------------------
function currentSeriesProvider() {
  if (isDemoMode()) return (symbol, timeframe) => fetchDemoSeries(symbol, { timeframe });
  const apiKey = els.apiKey.value.trim();
  return (symbol, timeframe) => fetchTwelveSeries(symbol, { timeframe, apiKey });
}

function buildTimeframeButtons() {
  els.timeframeRow.innerHTML = "";
  for (const [key, tf] of Object.entries(TIMEFRAMES)) {
    const btn = document.createElement("button");
    btn.className = "tf-btn";
    btn.dataset.tf = key;
    btn.textContent = tf.label;
    btn.addEventListener("click", () => loadChart(chartSymbol, key));
    els.timeframeRow.appendChild(btn);
  }
}

function buildScanTimeframeOptions() {
  els.scanTimeframe.innerHTML = "";
  for (const [key, tf] of Object.entries(TIMEFRAMES)) {
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = tf.label;
    els.scanTimeframe.appendChild(opt);
  }
}

function setActiveTimeframe(key) {
  els.timeframeRow.querySelectorAll(".tf-btn").forEach((b) =>
    b.classList.toggle("active", b.dataset.tf === key)
  );
}

async function loadChart(symbol, timeframe) {
  chartSymbol = symbol;
  setActiveTimeframe(timeframe);

  const item = WATCHLIST.find((w) => w.symbol === symbol);
  const tf = TIMEFRAMES[timeframe];

  els.chartTitle.textContent = `${item ? item.name : symbol} · ${symbol} — ${tf.label}`;
  els.chartContainer.textContent = "Loading…";

  try {
    const series = await currentSeriesProvider()(symbol, timeframe);
    let highlights;
    let caption;

    if (isDemoMode()) {
      const hl = demoHighlight(symbol, timeframe);
      highlights = hl ? [hl] : [];
      caption = hl
        ? `${tf.label} view: ${hl.name} (${suggestedAction(hl.bias)}) — highlighted.`
        : `${tf.label} view: no pattern for this ticker — the conservative action is Hold.`;
    } else {
      highlights = findPatterns(series);
      if (highlights.length) {
        const recent = highlights[highlights.length - 1];
        caption = `${tf.label} view: ${highlights.length} pattern(s) highlighted — most recent: ` +
          `${recent.name} (${suggestedAction(recent.bias)}).`;
      } else {
        caption = `${tf.label} view: no candlestick patterns detected — Hold.`;
      }
    }

    renderCandlestickChart(els.chartContainer, series, { highlights });
    els.chartCaption.textContent = caption;
  } catch (err) {
    els.chartContainer.textContent = `Couldn't load chart: ${err.message}`;
    els.chartCaption.textContent = "";
  }
}

function openChart(symbol) {
  els.modal.classList.remove("hidden");
  loadChart(symbol, scanTimeframe());
}

function closeChart() {
  els.modal.classList.add("hidden");
  chartSymbol = null;
}

// ---- Settings ------------------------------------------------------------
function openSettings() {
  els.settingsModal.classList.remove("hidden");
}
function closeSettings() {
  els.settingsModal.classList.add("hidden");
}
function updateBrowserBadge() {
  const on = els.notifyBrowser.checked;
  els.notifyBrowserBadge.textContent = on ? "on" : "off";
  els.notifyBrowserBadge.classList.toggle("on", on);
}

// Show the Discord webhook field only when the Discord box is checked, and keep
// its on/off badge in sync (matching the Web browser badge).
function updateDiscordReveal() {
  const on = els.notifyDiscord.checked;
  els.discordConfig.classList.toggle("hidden", !on);
  els.notifyDiscordBadge.textContent = on ? "on" : "off";
  els.notifyDiscordBadge.classList.toggle("on", on);
}

// ---- Settings ------------------------------------------------------------
function applyDemoVisibility() {
  els.apiRow.classList.toggle("hidden", isDemoMode());
}

function loadSettings() {
  els.apiKey.value = store.get(STORAGE_KEYS.apiKey, "");
  els.demoToggle.checked = store.get(STORAGE_KEYS.demo, "true") === "true";
  const storedTf = store.get(STORAGE_KEYS.scanTf, DEFAULT_TIMEFRAME);
  els.scanTimeframe.value = TIMEFRAMES[storedTf] ? storedTf : DEFAULT_TIMEFRAME;
  els.notifyBrowser.checked = store.get(STORAGE_KEYS.notifyBrowser, "true") === "true";
  els.notifyDiscord.checked = store.get(STORAGE_KEYS.notifyDiscord, "false") === "true";
  els.discordWebhook.value = store.get(STORAGE_KEYS.discordWebhook, "");
  els.notifyWatchlist.checked = store.get(STORAGE_KEYS.notifyWatchlist, "false") === "true";
  els.notifySpecific.checked = store.get(STORAGE_KEYS.notifySpecific, "false") === "true";
  els.watchlistTf.value = store.get(STORAGE_KEYS.watchlistTf, "any");
  const storedRules = store.getJSON(STORAGE_KEYS.notifyRules, []);
  notifyRules = Array.isArray(storedRules)
    ? storedRules.filter((r) => r && typeof r.pattern === "string" && typeof r.timeframe === "string")
    : [];
  myWatchlist = new Set(store.getJSON(STORAGE_KEYS.watchlist, []));
  // Load filters, dropping any stale names; fall back to "all" if nothing valid.
  const storedFilters = store.getJSON(STORAGE_KEYS.filters, null);
  const validFilters = Array.isArray(storedFilters)
    ? storedFilters.filter((n) => ALL_FILTER_NAMES.includes(n))
    : [];
  enabledFilters = validFilters.length ? new Set(validFilters) : new Set(ALL_FILTER_NAMES);
  view = store.get(STORAGE_KEYS.view, "all");
  applyDemoVisibility();
}

// ---- Event listeners -----------------------------------------------------
// Requesting during the first click satisfies browsers that require a gesture.
document.addEventListener("click", () => browserNotifier.requestPermission().catch(() => {}), { once: true });

els.viewTabs.addEventListener("click", (e) => {
  const tab = e.target.closest(".tab");
  if (tab) switchView(tab.dataset.view);
});

els.search.addEventListener("input", () => {
  query = els.search.value.trim();
  page = 0;
  refreshAndScan();
});

els.prevPage.addEventListener("click", () => {
  if (page > 0) {
    page--;
    refreshAndScan();
  }
});
els.nextPage.addEventListener("click", () => {
  if (page < pageCount() - 1) {
    page++;
    refreshAndScan();
  }
});

els.logToggle.addEventListener("click", () => {
  els.log.classList.toggle("expanded");
  updateLogToggle();
});

// Table clicks: the ＋ toggles My Watchlist; company/ticker opens the chart.
els.tbody.addEventListener("click", (e) => {
  const symbol = e.target.closest("tr")?.dataset.symbol;
  if (!symbol) return;
  if (e.target.closest("[data-fav]")) {
    toggleFav(symbol);
    return;
  }
  if (e.target.closest("[data-chart]")) openChart(symbol);
});

// Close the chart modal via the ✕ button, backdrop click, or Escape.
els.chartClose.addEventListener("click", closeChart);
els.modal.addEventListener("click", (e) => {
  if (e.target.hasAttribute("data-close")) closeChart();
});

// Settings modal.
els.settingsBtn.addEventListener("click", openSettings);
els.settingsClose.addEventListener("click", closeSettings);
els.settingsModal.addEventListener("click", (e) => {
  if (e.target.hasAttribute("data-close")) closeSettings();
});
els.notifyBrowser.addEventListener("change", () => {
  store.set(STORAGE_KEYS.notifyBrowser, els.notifyBrowser.checked);
  if (els.notifyBrowser.checked) browserNotifier.requestPermission().catch(() => {});
  updateBrowserBadge();
});

els.notifyDiscord.addEventListener("change", () => {
  store.set(STORAGE_KEYS.notifyDiscord, els.notifyDiscord.checked);
  updateDiscordReveal();
});
els.discordWebhook.addEventListener("change", () => {
  store.set(STORAGE_KEYS.discordWebhook, els.discordWebhook.value.trim());
});
els.discordTest.addEventListener("click", async () => {
  const out = els.discordTestResult;
  const url = els.discordWebhook.value.trim();
  if (!url) {
    out.textContent = "Paste your Discord webhook URL first.";
    out.className = "test-result err";
    return;
  }
  store.set(STORAGE_KEYS.discordWebhook, url);
  out.textContent = "Sending…";
  out.className = "test-result";
  const res = await discordNotifier.sendNotification(
    { title: "🔔 Candlestick Alert connected", body: "This is a test message from your app." },
    url
  );
  if (res.ok) {
    out.textContent = "Sent ✓ — check your Discord channel.";
    out.className = "test-result ok";
  } else {
    out.textContent = `Failed: ${res.detail}`;
    out.className = "test-result err";
    console.error("Discord test failed:", res.detail);
  }
});

els.filterList.addEventListener("change", (e) => {
  const cb = e.target.closest("[data-filter]");
  if (!cb) return;
  const name = cb.dataset.filter;
  if (cb.checked) enabledFilters.add(name);
  else enabledFilters.delete(name);
  persistFilters();
  page = 0;
  refreshAndScan();
});
els.selectAllFilters.addEventListener("click", () => setAllFilters(true));
els.deselectAllFilters.addEventListener("click", () => setAllFilters(false));

// Notification alerts
els.notifyWatchlist.addEventListener("change", () => {
  store.set(STORAGE_KEYS.notifyWatchlist, els.notifyWatchlist.checked);
  updateWatchlistReveal();
});
els.watchlistTf.addEventListener("change", () => {
  store.set(STORAGE_KEYS.watchlistTf, els.watchlistTf.value);
});
els.notifySpecific.addEventListener("change", () => {
  store.set(STORAGE_KEYS.notifySpecific, els.notifySpecific.checked);
  updateSpecificReveal();
});
els.addRule.addEventListener("click", () => {
  notifyRules.push({ pattern: "any", timeframe: "any" });
  persistRules();
  buildRulesList();
});
els.clearRules.addEventListener("click", () => {
  notifyRules = [];
  persistRules();
  buildRulesList();
});
els.rulesList.addEventListener("change", (e) => {
  const row = e.target.closest(".rule-row");
  if (!row) return;
  const i = Number(row.dataset.index);
  if (e.target.classList.contains("rule-pattern")) notifyRules[i].pattern = e.target.value;
  if (e.target.classList.contains("rule-timeframe")) notifyRules[i].timeframe = e.target.value;
  persistRules();
});
els.rulesList.addEventListener("click", (e) => {
  if (!e.target.classList.contains("rule-delete")) return;
  const i = Number(e.target.closest(".rule-row").dataset.index);
  notifyRules.splice(i, 1);
  persistRules();
  buildRulesList();
});

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!els.modal.classList.contains("hidden")) closeChart();
  if (!els.settingsModal.classList.contains("hidden")) closeSettings();
});

els.demoToggle.addEventListener("change", () => {
  store.set(STORAGE_KEYS.demo, els.demoToggle.checked);
  applyDemoVisibility();
  for (const key of Object.keys(results)) delete results[key]; // results are mode-specific
  refreshAndScan();
});

els.apiKey.addEventListener("change", () => {
  store.set(STORAGE_KEYS.apiKey, els.apiKey.value.trim());
});

els.scanTimeframe.addEventListener("change", () => {
  store.set(STORAGE_KEYS.scanTf, els.scanTimeframe.value);
  for (const key of Object.keys(results)) delete results[key]; // signals differ per timeframe
  refreshAndScan();
});

// ---- Init ----------------------------------------------------------------
// Surface any error to the status line instead of failing silently (blank page).
window.addEventListener("error", (e) => setStatus(`Error: ${e.message}`));

try {
  buildTimeframeButtons();
  buildScanTimeframeOptions();
  buildWatchlistTfOptions();
  loadSettings();
  updateTabs();
  updateBrowserBadge();
  updateDiscordReveal();
  buildSignalFilters();
  buildRulesList();
  updateWatchlistReveal();
  updateSpecificReveal();
  renderRows();
  logEntries = store.getJSON(STORAGE_KEYS.log, []); // restore log across refreshes
  renderLog();
} catch (err) {
  console.error("Startup error:", err);
  setStatus(`Startup error: ${err.message}`);
}

// Ask for notification permission up front (best effort; alerts still show in
// the log if denied), then scan and keep auto-scanning for accuracy.
browserNotifier.requestPermission().catch(() => {});
scanVisible();
setInterval(scanVisible, AUTO_SCAN_MS);
