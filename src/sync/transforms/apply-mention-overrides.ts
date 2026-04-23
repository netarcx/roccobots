/**
 * Rewrite @twitterHandle mentions to their Bluesky equivalents.
 *
 * Per-bot entries take precedence over global entries. Missing keys fall back
 * to the global map, and handles with no mapping on either side are left
 * untouched.
 *
 * Twitter handles are case-insensitive, so lookups are done against the
 * lowercased handle. Callers are expected to store keys in lowercase; this
 * function defensively lowercases on lookup anyway.
 */

// Twitter handle grammar: 1-15 chars, alphanumeric + underscore, preceded by
// start-of-string or a non-handle character (so we don't eat email addresses
// or mid-word "@" inside URLs).
const MENTION_REGEX = /(^|[^A-Za-z0-9_@])@([A-Za-z0-9_]{1,15})\b/g;

export type MentionMap = Record<string, string>;

export function applyMentionOverrides(
  text: string,
  opts: {
    platformId: string;
    perBot?: MentionMap | null;
    global?: MentionMap | null;
  },
): string {
  if (opts.platformId !== "bluesky") return text;
  const perBot = opts.perBot || {};
  const global = opts.global || {};
  if (Object.keys(perBot).length === 0 && Object.keys(global).length === 0) {
    return text;
  }

  return text.replace(
    MENTION_REGEX,
    (match, prefix: string, handle: string) => {
      const key = handle.toLowerCase();
      const target = Object.prototype.hasOwnProperty.call(perBot, key)
        ? perBot[key]
        : global[key];
      if (!target) return match;
      return `${prefix}@${target}`;
    },
  );
}
