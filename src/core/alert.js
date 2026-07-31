/*
 * Turns a detected pattern into a human-readable alert message.
 *
 * Kept separate from both detection and delivery so every notifier — browser,
 * Slack, email — formats alerts identically. Returns a plain { title, body }.
 */
const ICON = { bullish: "🟢", bearish: "🔴", neutral: "🟡" };

export function formatAlert(company, symbol, pattern, candle) {
  const icon = ICON[pattern.bias] ?? "•";
  return {
    title: `${icon} ${pattern.name}: ${company}`,
    body: `${symbol} closed at ${candle.close.toFixed(2)} on ${candle.datetime}`,
  };
}
