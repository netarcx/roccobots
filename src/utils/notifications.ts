import { APPRISE_URL, APPRISE_URLS } from "env";

const COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes
const cooldowns = new Map<string, number>();

export async function sendNotification(
  title: string,
  body: string,
  type: "info" | "success" | "warning" | "failure" = "failure",
  cooldownKey?: string,
): Promise<void> {
  if (!APPRISE_URL || !APPRISE_URLS) return;

  if (cooldownKey) {
    const lastSent = cooldowns.get(cooldownKey);
    if (lastSent && Date.now() - lastSent < COOLDOWN_MS) return;
    cooldowns.set(cooldownKey, Date.now());
  }

  try {
    await fetch(`${APPRISE_URL}/notify/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        urls: APPRISE_URLS,
        title,
        body,
        type,
      }),
    });
  } catch (error) {
    console.error("Failed to send Apprise notification:", error);
  }
}
