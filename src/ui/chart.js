/*
 * Minimal dependency-free candlestick chart, rendered as inline SVG, with an
 * x-axis, pattern highlight bands, and a hover crosshair + tooltip.
 *
 * renderCandlestickChart(container, candles, opts)
 *   container         DOM element to render into (made position:relative)
 *   candles           oldest-first array of { datetime, open, high, low, close }
 *   opts.highlights   [{ start, end, bias }] index ranges to shade (patterns)
 */
const W = 760;
const H = 380;
const PAD = { top: 16, right: 54, bottom: 34, left: 8 };

const GREEN = "#16a34a";
const RED = "#dc2626";
const GRID = "#e5e7eb";
const TEXT = "#6b7280";

// Highlight band styling per pattern bias.
const BAND = {
  bullish: { fill: "rgba(22,163,74,0.12)", stroke: GREEN },
  bearish: { fill: "rgba(220,38,38,0.10)", stroke: RED },
  neutral: { fill: "rgba(180,83,9,0.14)", stroke: "#b45309" },
};

function svgEl(tag, attrs) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

// "2026-07-30 14:30:00" -> "07-30 14:30" ; "2026-07-30" -> "07-30"
function shortLabel(dt) {
  if (!dt) return "";
  const [date, time] = String(dt).split(" ");
  const md = date.length >= 10 ? date.slice(5) : date;
  return time ? `${md} ${time.slice(0, 5)}` : md;
}

export function renderCandlestickChart(container, candles, { highlights = [] } = {}) {
  container.innerHTML = "";
  container.style.position = "relative";
  if (!candles || candles.length === 0) {
    container.textContent = "No data.";
    return;
  }

  const lo = Math.min(...candles.map((c) => c.low));
  const hi = Math.max(...candles.map((c) => c.high));
  const span = hi - lo || 1;

  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const step = plotW / candles.length;
  const bodyW = Math.max(1, step * 0.6);

  const x = (i) => PAD.left + step * (i + 0.5);
  const y = (price) => PAD.top + ((hi - price) / span) * plotH;

  const svg = svgEl("svg", {
    viewBox: `0 0 ${W} ${H}`,
    width: "100%",
    preserveAspectRatio: "xMidYMid meet",
    role: "img",
  });
  svg.style.display = "block";

  // Horizontal grid + price labels.
  for (let g = 0; g <= 4; g++) {
    const price = hi - (span * g) / 4;
    const gy = y(price);
    svg.appendChild(svgEl("line", { x1: PAD.left, y1: gy, x2: W - PAD.right, y2: gy, stroke: GRID, "stroke-width": 1 }));
    const label = svgEl("text", { x: W - PAD.right + 6, y: gy + 4, fill: TEXT, "font-size": 11 });
    label.textContent = price.toFixed(2);
    svg.appendChild(label);
  }

  // Pattern highlight bands (one per occurrence, colored by bias).
  for (const h of highlights) {
    const c = BAND[h.bias] || BAND.neutral;
    const bx = PAD.left + step * h.start;
    const bw = step * (h.end - h.start + 1);
    svg.appendChild(svgEl("rect", {
      x: bx, y: PAD.top, width: bw, height: plotH,
      fill: c.fill, stroke: c.stroke, "stroke-width": 1, "stroke-dasharray": "4 3", rx: 3,
    }));
  }

  // Candles.
  candles.forEach((c, i) => {
    const color = c.close >= c.open ? GREEN : RED;
    const cx = x(i);
    svg.appendChild(svgEl("line", { x1: cx, y1: y(c.high), x2: cx, y2: y(c.low), stroke: color, "stroke-width": 1 }));
    const yTop = y(Math.max(c.open, c.close));
    const bodyH = Math.max(1, Math.abs(y(c.open) - y(c.close)));
    svg.appendChild(svgEl("rect", { x: cx - bodyW / 2, y: yTop, width: bodyW, height: bodyH, fill: color }));
  });

  // X-axis date labels (~6 evenly spaced).
  const labelCount = Math.min(6, candles.length);
  for (let k = 0; k < labelCount; k++) {
    const idx = Math.round((k * (candles.length - 1)) / (labelCount - 1 || 1));
    const t = svgEl("text", { x: x(idx), y: H - 12, fill: TEXT, "font-size": 10, "text-anchor": "middle" });
    t.textContent = shortLabel(candles[idx].datetime);
    svg.appendChild(t);
  }

  // Hover crosshair (hidden until mousemove).
  const cross = svgEl("line", { x1: 0, y1: PAD.top, x2: 0, y2: PAD.top + plotH, stroke: TEXT, "stroke-width": 1, "stroke-dasharray": "3 3", opacity: 0 });
  svg.appendChild(cross);

  container.appendChild(svg);

  // Tooltip (HTML overlay so text is crisp and easy to position).
  const tip = document.createElement("div");
  tip.className = "chart-tooltip";
  tip.style.display = "none";
  container.appendChild(tip);

  svg.addEventListener("mousemove", (e) => {
    const rect = svg.getBoundingClientRect();
    const svgX = (e.clientX - rect.left) * (W / rect.width);
    let idx = Math.floor((svgX - PAD.left) / step);
    idx = Math.max(0, Math.min(candles.length - 1, idx));
    const c = candles[idx];

    cross.setAttribute("x1", x(idx));
    cross.setAttribute("x2", x(idx));
    cross.setAttribute("opacity", 1);

    tip.style.display = "block";
    tip.innerHTML =
      `<strong>${c.datetime}</strong><br>` +
      `O ${c.open.toFixed(2)} · H ${c.high.toFixed(2)}<br>` +
      `L ${c.low.toFixed(2)} · C ${c.close.toFixed(2)}`;

    const cRect = container.getBoundingClientRect();
    let left = e.clientX - cRect.left + 14;
    const top = e.clientY - cRect.top + 14;
    if (left > cRect.width - 140) left = e.clientX - cRect.left - 140;
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  });
  svg.addEventListener("mouseleave", () => {
    cross.setAttribute("opacity", 0);
    tip.style.display = "none";
  });
}
