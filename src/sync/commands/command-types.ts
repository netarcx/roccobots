export interface ResponseMessages {
  restart: string;
  sync: string;
  source: string;
  sourceChanged: string;
  unauthorized: string;
  error: string;
  unknown: string;
  help: string;
  status: string;
  settingChanged: string;
  invalidValue: string;
  pin: string;
  unpin: string;
  mute: string;
  unmute: string;
  last: string;
  stats: string;
}

export const DEFAULT_RESPONSES: ResponseMessages = {
  restart: "Restarting bot...",
  sync: "Sync triggered!",
  source: "Current source: @{handle}",
  sourceChanged: "Source changed to @{handle}. Restarting...",
  unauthorized: "You are not authorized to use commands.",
  error: "Command failed: {error}",
  unknown:
    "Unknown command. Available: !sync, !restart, !source, !status, !frequency, !posts, !bio, !avatar, !name, !header, !backdate, !pin, !unpin, !mute, !unmute, !last, !stats, !help",
  help: "Commands: !sync, !restart, !source, !status, !frequency, !posts, !bio, !avatar, !name, !header, !backdate, !pin, !unpin, !mute, !unmute, !last, !stats, !help",
  status: "{status}",
  settingChanged: "{setting} set to {value}.",
  invalidValue: "Invalid value for !{command}. {hint}",
  pin: "Post pinned!",
  unpin: "Post unpinned!",
  mute: "Bot muted. Syncing paused until !unmute.",
  unmute: "Bot unmuted. Syncing resumed.",
  last: "{url}",
  stats: "{stats}",
};

export type SettingKey =
  | "frequency"
  | "posts"
  | "bio"
  | "avatar"
  | "name"
  | "header"
  | "backdate";

export interface CommandConfig {
  enabled: boolean;
  trustedHandles: string[];
  pollIntervalSec: number;
  responseMessages: ResponseMessages;
  lastSeenAt: string | null;
}

export interface ParsedCommand {
  type:
    | "restart"
    | "sync"
    | "source"
    | "status"
    | "help"
    | "frequency"
    | "posts"
    | "bio"
    | "avatar"
    | "name"
    | "header"
    | "backdate"
    | "pin"
    | "unpin"
    | "mute"
    | "unmute"
    | "last"
    | "stats";
  args: string[];
  raw: string;
}

export interface CommandExecutor {
  restart(botId: number): Promise<void>;
  sync(botId: number): Promise<void>;
  changeSource(botId: number, newHandle: string): Promise<void>;
  getSource(botId: number): Promise<string>;
  getStatus(botId: number): Promise<string>;
  setSetting(botId: number, key: SettingKey, value: unknown): Promise<void>;
  mute(botId: number): Promise<void>;
  unmute(botId: number): Promise<void>;
  getLastPost(
    botId: number,
  ): Promise<{ url: string; uri: string; cid: string } | null>;
  getStats(botId: number): Promise<string>;
}
