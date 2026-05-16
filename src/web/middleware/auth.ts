import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { Context, Next } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";

const sessions = new Map<
  string,
  {
    authenticated: boolean;
    createdAt: Date;
    expiresAt: Date;
  }
>();

function generateSessionId(): string {
  return randomBytes(32).toString("hex");
}

export async function requireAuth(c: Context, next: Next) {
  const sessionId = getCookie(c, "session_id");

  if (!sessionId || !sessions.has(sessionId)) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const session = sessions.get(sessionId)!;

  if (!session.authenticated || session.expiresAt < new Date()) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  session.expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  await next();
}

export async function requireAuthPage(c: Context, next: Next) {
  const sessionId = getCookie(c, "session_id");

  if (!sessionId || !sessions.has(sessionId)) {
    return c.redirect("/login");
  }

  const session = sessions.get(sessionId)!;

  if (!session.authenticated || session.expiresAt < new Date()) {
    return c.redirect("/login");
  }

  session.expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  await next();
}

export async function sessionMiddleware(c: Context, next: Next) {
  const sessionId = getCookie(c, "session_id");

  if (sessionId && sessions.has(sessionId)) {
    const session = sessions.get(sessionId)!;
    if (session.expiresAt > new Date()) {
      c.set("session", session);
      c.set("sessionId", sessionId);
    } else {
      sessions.delete(sessionId);
    }
  }

  await next();
}

export function login(c: Context, password: string): boolean {
  const adminPassword = process.env.WEB_ADMIN_PASSWORD;

  if (!adminPassword) {
    throw new Error("WEB_ADMIN_PASSWORD environment variable not set");
  }

  const passwordHash = createHash("sha256").update(password).digest();
  const adminHash = createHash("sha256").update(adminPassword).digest();

  if (timingSafeEqual(passwordHash, adminHash)) {
    const newSessionId = generateSessionId();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const session = {
      authenticated: true,
      createdAt: new Date(),
      expiresAt,
    };
    sessions.set(newSessionId, session);

    setCookie(c, "session_id", newSessionId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "Strict",
      maxAge: 24 * 60 * 60,
    });

    c.set("session", session);
    c.set("sessionId", newSessionId);
    return true;
  }

  return false;
}

/**
 * Logout handler
 */
export function logout(c: Context): void {
  const sessionId = getCookie(c, "session_id");

  if (sessionId) {
    sessions.delete(sessionId);
    deleteCookie(c, "session_id");
  }
}

/**
 * Check if current session is authenticated
 */
export function isAuthenticated(c: Context): boolean {
  const session = c.get("session") as any;
  return session?.authenticated ?? false;
}

/**
 * Clean up expired sessions (should be called periodically)
 */
export function cleanupSessions(): void {
  const now = new Date();
  for (const [sessionId, session] of sessions.entries()) {
    if (session.expiresAt < now) {
      sessions.delete(sessionId);
    }
  }
}

// Clean up sessions every hour
setInterval(cleanupSessions, 60 * 60 * 1000);
