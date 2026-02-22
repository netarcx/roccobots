import { ParsedCommand } from "./command-types";

const TOGGLE_COMMANDS = [
  "posts",
  "bio",
  "avatar",
  "name",
  "header",
  "backdate",
] as const;

/**
 * Parse a command from mention text.
 * Looks for !command tokens anywhere in the text.
 * The `!` prefix is required to avoid matching casual usage of these words.
 */
export function parseCommand(text: string): ParsedCommand | null {
  // Normalize whitespace
  const normalized = text.replace(/\s+/g, " ").trim();

  // Match !restart
  if (/(?:^|\s)!restart\b/i.test(normalized)) {
    return { type: "restart", args: [], raw: normalized };
  }

  // Match !sync
  if (/(?:^|\s)!sync\b/i.test(normalized)) {
    return { type: "sync", args: [], raw: normalized };
  }

  // Match !source with optional @handle argument
  const sourceMatch = /(?:^|\s)!source(?:\s+@?(\S+))?/i.exec(normalized);
  if (sourceMatch) {
    const handle = sourceMatch[1];
    return {
      type: "source",
      args: handle ? [handle.replace(/^@/, "")] : [],
      raw: normalized,
    };
  }

  // Match !help
  if (/(?:^|\s)!help\b/i.test(normalized)) {
    return { type: "help", args: [], raw: normalized };
  }

  // Match !status
  if (/(?:^|\s)!status\b/i.test(normalized)) {
    return { type: "status", args: [], raw: normalized };
  }

  // Match !frequency with numeric argument
  const freqMatch = /(?:^|\s)!frequency(?:\s+(\S+))?/i.exec(normalized);
  if (freqMatch) {
    const arg = freqMatch[1];
    return {
      type: "frequency",
      args: arg ? [arg] : [],
      raw: normalized,
    };
  }

  // Match toggle commands: !posts, !bio, !avatar, !name, !header, !backdate
  for (const cmd of TOGGLE_COMMANDS) {
    const toggleMatch = new RegExp(`(?:^|\\s)!${cmd}(?:\\s+(\\S+))?`, "i").exec(
      normalized,
    );
    if (toggleMatch) {
      const arg = toggleMatch[1];
      return {
        type: cmd,
        args: arg ? [arg.toLowerCase()] : [],
        raw: normalized,
      };
    }
  }

  return null;
}
