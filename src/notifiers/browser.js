/*
 * Browser notification "sink".
 *
 * Notifier interface: `sendNotification({ title, body })`. Future sinks
 * (Slack, email) will implement the same signature so the scan loop doesn't
 * care how an alert is delivered.
 */
export function isSupported() {
  return typeof window !== "undefined" && "Notification" in window;
}

export async function requestPermission() {
  if (!isSupported()) return "unsupported";
  return Notification.requestPermission();
}

export function sendNotification({ title, body }) {
  if (isSupported() && Notification.permission === "granted") {
    new Notification(title, { body });
    return true;
  }
  return false;
}
