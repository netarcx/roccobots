import AtpAgent, { CredentialSession, RichText } from "@atproto/api";
import { Notification } from "@atproto/api/dist/client/types/app/bsky/notification/listNotifications";
import { EventEmitter } from "events";

import { parseCommand } from "./command-parser";
import {
  CommandConfig,
  CommandExecutor,
  DEFAULT_RESPONSES,
  SettingKey,
} from "./command-types";

interface BlueskyCredentials {
  instance: string;
  identifier: string;
  password: string;
}

interface CommandPollerLogEvent {
  level: "info" | "warn" | "error" | "success";
  message: string;
  platform: "bluesky-commands";
}

export class CommandPoller extends EventEmitter {
  private botId: number;
  private config: CommandConfig;
  private credentials: BlueskyCredentials;
  private executor: CommandExecutor;
  private agent: AtpAgent | null = null;
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private lastSeenAt: string | null;
  private onLastSeenAtUpdate: (botId: number, ts: string) => Promise<void>;
  private onConfigRefresh: (botId: number) => Promise<CommandConfig | null>;
  private polling = false;

  constructor(opts: {
    botId: number;
    config: CommandConfig;
    credentials: BlueskyCredentials;
    executor: CommandExecutor;
    lastSeenAt: string | null;
    onLastSeenAtUpdate: (botId: number, ts: string) => Promise<void>;
    onConfigRefresh: (botId: number) => Promise<CommandConfig | null>;
  }) {
    super();
    this.botId = opts.botId;
    this.config = opts.config;
    this.credentials = opts.credentials;
    this.executor = opts.executor;
    this.lastSeenAt = opts.lastSeenAt;
    this.onLastSeenAtUpdate = opts.onLastSeenAtUpdate;
    this.onConfigRefresh = opts.onConfigRefresh;
  }

  private emitLog(
    level: CommandPollerLogEvent["level"],
    message: string,
  ): void {
    this.emit("log", {
      level,
      message,
      platform: "bluesky-commands",
    } satisfies CommandPollerLogEvent);
  }

  async start(): Promise<void> {
    try {
      const session = new CredentialSession(
        new URL(`https://${this.credentials.instance}`),
      );
      this.agent = new AtpAgent(session);
      await this.agent.login({
        identifier: this.credentials.identifier,
        password: this.credentials.password,
      });
      this.emitLog("success", "Command poller connected to Bluesky");
    } catch (error) {
      this.emitLog("error", `Command poller failed to connect: ${error}`);
      throw error;
    }

    // Poll immediately, then on interval
    this.poll();
    this.pollInterval = setInterval(
      () => this.poll(),
      this.config.pollIntervalSec * 1000,
    );
  }

  stop(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  private async poll(): Promise<void> {
    if (!this.agent || this.polling) return;
    this.polling = true;

    try {
      // Re-read config from DB so trusted handles / settings update without restart
      const freshConfig = await this.onConfigRefresh(this.botId);
      if (freshConfig) {
        this.config = freshConfig;
      }

      const res = await this.agent.listNotifications({ limit: 50 });
      const notifications = res.data.notifications;

      const allMentions = notifications.filter((n) => n.reason === "mention");

      // Filter to mentions newer than lastSeenAt
      const newMentions = allMentions.filter((n) => {
        if (!this.lastSeenAt) return true;
        return n.indexedAt > this.lastSeenAt;
      });

      // Filter out self-mentions
      const mentions = newMentions
        .filter(
          (n) =>
            n.author.handle !== this.credentials.identifier &&
            n.author.did !== this.agent!.session?.did,
        )
        // Process oldest first
        .sort((a, b) => a.indexedAt.localeCompare(b.indexedAt));

      if (allMentions.length > 0) {
        this.emitLog(
          "info",
          `Poll: ${notifications.length} notifications, ${allMentions.length} mentions, ${newMentions.length} new, ${mentions.length} actionable (lastSeenAt: ${this.lastSeenAt ?? "none"})`,
        );
        // Log the text of each mention for debugging
        for (const m of allMentions) {
          const text = String(
            (m.record as Record<string, unknown>)?.text ?? "",
          );
          const isNew = !this.lastSeenAt || m.indexedAt > this.lastSeenAt;
          this.emitLog(
            "info",
            `  mention from @${m.author.handle} [${m.indexedAt}]${isNew ? "" : " (skipped: before lastSeenAt)"}: ${text.substring(0, 100)}`,
          );
        }
      }

      for (const mention of mentions) {
        await this.processMention(mention);
      }

      // Mark notifications as read
      if (mentions.length > 0) {
        await this.agent.updateSeenNotifications();
      }
    } catch (error) {
      this.emitLog("error", `Poll failed: ${error}`);
    } finally {
      this.polling = false;
    }
  }

  private async processMention(notification: Notification): Promise<void> {
    const authorHandle = notification.author.handle;
    const postText = String(
      (notification.record as Record<string, unknown>)?.text ?? "",
    );
    const responses = this.config.responseMessages ?? DEFAULT_RESPONSES;

    // Persist lastSeenAt before executing (crash-safe dedup)
    this.lastSeenAt = notification.indexedAt;
    await this.onLastSeenAtUpdate(this.botId, notification.indexedAt);

    // Check trusted handles
    const isTrusted = this.config.trustedHandles.some(
      (h) => h.toLowerCase() === authorHandle.toLowerCase(),
    );
    if (!isTrusted) {
      this.emitLog(
        "warn",
        `Unauthorized command attempt from @${authorHandle}: ${postText}`,
      );
      return;
    }

    // Parse command
    const command = parseCommand(postText);
    if (!command) {
      this.emitLog(
        "info",
        `Unknown command from @${authorHandle}: ${postText}`,
      );
      await this.reply(notification, responses.unknown);
      return;
    }

    this.emitLog(
      "info",
      `Command from @${authorHandle}: !${command.type}${command.args.length ? " " + command.args.join(" ") : ""}`,
    );

    try {
      switch (command.type) {
        case "restart":
          await this.reply(notification, responses.restart);
          await this.executor.restart(this.botId);
          break;

        case "sync":
          await this.executor.sync(this.botId);
          await this.reply(notification, responses.sync);
          break;

        case "source":
          if (command.args.length > 0) {
            const newHandle = command.args[0];
            await this.reply(
              notification,
              responses.sourceChanged.replace("{handle}", newHandle),
            );
            await this.executor.changeSource(this.botId, newHandle);
          } else {
            const currentHandle = await this.executor.getSource(this.botId);
            await this.reply(
              notification,
              responses.source.replace("{handle}", currentHandle),
            );
          }
          break;

        case "help":
          await this.reply(notification, responses.help);
          break;

        case "status": {
          const statusText = await this.executor.getStatus(this.botId);
          await this.reply(
            notification,
            responses.status.replace("{status}", statusText),
          );
          break;
        }

        case "frequency": {
          if (command.args.length === 0) {
            await this.reply(
              notification,
              responses.invalidValue
                .replace("{command}", "frequency")
                .replace("{hint}", "Usage: !frequency <minutes>"),
            );
            break;
          }
          const minutes = parseInt(command.args[0], 10);
          if (isNaN(minutes) || minutes < 1) {
            await this.reply(
              notification,
              responses.invalidValue
                .replace("{command}", "frequency")
                .replace("{hint}", "Must be a number >= 1."),
            );
            break;
          }
          await this.executor.setSetting(this.botId, "frequency", minutes);
          await this.reply(
            notification,
            responses.settingChanged
              .replace("{setting}", "Frequency")
              .replace("{value}", `${minutes} min`),
          );
          break;
        }

        case "posts":
        case "bio":
        case "avatar":
        case "name":
        case "header":
        case "backdate": {
          const toggleArg = command.args[0];
          const boolValue = this.parseToggle(toggleArg);
          if (boolValue === null) {
            await this.reply(
              notification,
              responses.invalidValue
                .replace("{command}", command.type)
                .replace(
                  "{hint}",
                  "Usage: !{cmd} on/off".replace("{cmd}", command.type),
                ),
            );
            break;
          }
          await this.executor.setSetting(
            this.botId,
            command.type as SettingKey,
            boolValue,
          );
          await this.reply(
            notification,
            responses.settingChanged
              .replace(
                "{setting}",
                command.type.charAt(0).toUpperCase() + command.type.slice(1),
              )
              .replace("{value}", boolValue ? "on" : "off"),
          );
          break;
        }
      }

      this.emitLog("success", `Command !${command.type} executed successfully`);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.emitLog("error", `Command !${command.type} failed: ${errorMessage}`);
      await this.reply(
        notification,
        responses.error.replace("{error}", errorMessage),
      );
    }
  }

  private parseToggle(arg: string | undefined): boolean | null {
    if (!arg) return null;
    const lower = arg.toLowerCase();
    if (["on", "true", "1"].includes(lower)) return true;
    if (["off", "false", "0"].includes(lower)) return false;
    return null;
  }

  private async reply(notification: Notification, text: string): Promise<void> {
    if (!this.agent) return;

    try {
      const richText = new RichText({ text });
      await richText.detectFacets(this.agent);

      // Build reply refs
      const record = notification.record as Record<string, unknown>;
      const replyField = record?.reply as
        | { root?: { uri: string; cid: string } }
        | undefined;
      const rootRef = replyField?.root ?? {
        uri: notification.uri,
        cid: notification.cid,
      };
      const parentRef = {
        uri: notification.uri,
        cid: notification.cid,
      };

      await this.agent.post({
        text: richText.text,
        facets: richText.facets,
        reply: {
          root: rootRef,
          parent: parentRef,
        },
      });
    } catch (error) {
      this.emitLog("error", `Failed to send reply: ${error}`);
    }
  }
}
