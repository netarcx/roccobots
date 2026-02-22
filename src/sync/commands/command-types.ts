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
}

export const DEFAULT_RESPONSES: ResponseMessages = {
  restart: "Restarting bot...",
  sync: "Sync triggered!",
  source: "Current source: @{handle}",
  sourceChanged: "Source changed to @{handle}. Restarting...",
  unauthorized: "You are not authorized to use commands.",
  error: "Command failed: {error}",
  unknown:
    "Unknown command. Available: !sync, !restart, !source, !status, !frequency, !posts, !bio, !avatar, !name, !header, !backdate, !help",
  help: "Commands: !sync, !restart, !source, !status, !frequency, !posts, !bio, !avatar, !name, !header, !backdate, !help",
  status: "{status}",
  settingChanged: "{setting} set to {value}.",
  invalidValue: "Invalid value for !{command}. {hint}",
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
    | "backdate";
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
}
