import { Context, Next } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { createHash, randomBytes } from "crypto";

// Session storage (in-memory for now, can be moved to DB later)
const sessions = new Map<
  string,
  {
    authenticated: boolean;
    createdAt: Date;
    expiresAt: Date;
  }
>();

/**
 * Generate a secure session ID
 */
function generateSessionId(): string {
  return randomBytes(32).toString("hex");
}

/**
 * Hash password for comparison
 */
function hashPassword(password: string): string {
  return createHash("sha256").update(password).digest("hex");
}

/**
 * Get or create session
 */
function getOrCreateSession(sessionId?: string): {
  sessionId: string;
  session: { authenticated: boolean; createdAt: Date; expiresAt: Date };
} {
  if (sessionId && sessions.has(sessionId)) {
    const session = sessions.get(sessionId)!;
    // Check if session is expired
    if (session.expiresAt > new Date()) {
      return { sessionId, session };
    } else {
      sessions.delete(sessionId);
    }
  }

  // Create new session
  const newSessionId = generateSessionId();
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + 24); // 24 hour sessions

  const newSession = {
    authenticated: false,
    createdAt: new Date(),
    expiresAt,
  };

  sessions.set(newSessionId, newSession);
  return { sessionId: newSessionId, session: newSession };
}

/**
 * Middleware to check if user is authenticated
 */
export async function requireAuth(c: Context, next: Next) {
  const sessionId = getCookie(c, "session_id");

  if (!sessionId || !sessions.has(sessionId)) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const session = sessions.get(sessionId)!;

  if (!session.authenticated || session.expiresAt < new Date()) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  // Extend session
  session.expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  await next();
}

/**
 * Middleware to attach session to context
 */
export async function sessionMiddleware(c: Context, next: Next) {
  const sessionId = getCookie(c, "session_id");
  const { sessionId: newSessionId, session } = getOrCreateSession(sessionId);

  if (!sessionId || sessionId !== newSessionId) {
    setCookie(c, "session_id", newSessionId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "Strict",
      maxAge: 24 * 60 * 60, // 24 hours
    });
  }

  c.set("session", session);
  c.set("sessionId", newSessionId);

  await next();
}

/**
 * Login handler
 */
export function login(c: Context, password: string): boolean {
  const adminPassword = process.env.WEB_ADMIN_PASSWORD;

  if (!adminPassword) {
    throw new Error("WEB_ADMIN_PASSWORD environment variable not set");
  }

  if (password === adminPassword) {
    const sessionId = c.get("sessionId") as string;
    const session = sessions.get(sessionId);

    if (session) {
      session.authenticated = true;
      session.expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    }

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
