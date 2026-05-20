import { DBType, Schema } from "db";
import { eq } from "drizzle-orm";
import { decryptJSON } from "web/services/encryption-service";

import { MentionMap } from "./apply-mention-overrides";

/**
 * Auto-derive twitter→bluesky mention mappings from all configured bots.
 * Each bot's twitterHandle maps to its Bluesky BLUESKY_IDENTIFIER credential.
 * Skips entries where the identifier is an email or DID (only bare handles
 * like `user.bsky.social` produce valid Bluesky mentions).
 */
export async function deriveAutoMentionOverrides(
  db: DBType,
): Promise<MentionMap> {
  const [botRows, platformRows] = await Promise.all([
    db
      .select({
        id: Schema.BotConfigs.id,
        twitterHandle: Schema.BotConfigs.twitterHandle,
      })
      .from(Schema.BotConfigs)
      .all(),
    db
      .select()
      .from(Schema.PlatformConfigs)
      .where(eq(Schema.PlatformConfigs.platformId, "bluesky"))
      .all(),
  ]);

  const bskyByBotId = new Map<number, string>();
  for (const p of platformRows) {
    try {
      const creds = decryptJSON<Record<string, string>>(p.credentials);
      const id = creds.BLUESKY_IDENTIFIER;
      if (id && !id.includes("@") && !id.startsWith("did:")) {
        bskyByBotId.set(Number(p.botConfigId), id);
      }
    } catch (_) {
      // skip rows with invalid/corrupt credentials
    }
  }

  const map: MentionMap = {};
  for (const bot of botRows) {
    const bskyHandle = bskyByBotId.get(Number(bot.id));
    if (bskyHandle && bot.twitterHandle) {
      map[bot.twitterHandle.replace(/^@/, "").toLowerCase()] = bskyHandle;
    }
  }
  return map;
}
