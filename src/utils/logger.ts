import { LOG_FORMAT } from "env";

const isJson = LOG_FORMAT === "json";

export function structuredLog(
  level: string,
  message: string,
  meta?: Record<string, unknown>,
): void {
  if (isJson) {
    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        level,
        msg: message,
        ...meta,
      }),
    );
  } else {
    const prefix = meta?.botId ? `[bot:${meta.botId}] ` : "";
    console.log(`[${level}] ${prefix}${message}`);
  }
}
