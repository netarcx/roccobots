import { DBType, Schema } from "db";
import { and, eq, isNull } from "drizzle-orm";
import { APPRISE_URL, APPRISE_URLS } from "env";

const COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes
const cooldowns = new Map<string, number>();

export async function shouldNotify(
  db: DBType,
  botId: number | null,
  eventType: string,
): Promise<boolean> {
  try {
    // Check bot-specific preference first
    if (botId !== null) {
      const botPref = await db
        .select()
        .from(Schema.NotificationPreferences)
        .where(
          and(
            eq(Schema.NotificationPreferences.botConfigId, botId),
            eq(Schema.NotificationPreferences.eventType, eventType),
          ),
        )
        .get();
      if (botPref) return botPref.enabled;
    }
    // Fall back to global preference
    const globalPref = await db
      .select()
      .from(Schema.NotificationPreferences)
      .where(
        and(
          isNull(Schema.NotificationPreferences.botConfigId),
          eq(Schema.NotificationPreferences.eventType, eventType),
        ),
      )
      .get();
    if (globalPref) return globalPref.enabled;
    return true; // Default to enabled if no preference set
  } catch (_) {
    return true;
  }
}

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
