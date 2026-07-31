/*
 * Discord notification sink — posts to a Discord channel via an incoming webhook.
 *
 * Notifier interface: sendNotification({ title, body }, webhookUrl).
 * The webhook URL is a per-user secret kept in the browser's localStorage; it is
 * never bundled or committed. Discord's webhook endpoint allows browser (CORS)
 * requests, so this works from the static app with no backend.
 */
// Returns { ok, detail } so callers can show why a send failed.
export async function sendNotification({ title, body }, webhookUrl) {
  if (!webhookUrl) return { ok: false, detail: "No webhook URL" };
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: `**${title}**\n${body}` }),
    });
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, detail: `Network/CORS error: ${e.message}` };
  }
}
