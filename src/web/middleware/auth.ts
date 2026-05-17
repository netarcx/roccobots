import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { Context, Next } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";

import { UserOutput, UserService } from "../services/user-service";

interface Session {
  authenticated: boolean;
  createdAt: Date;
  expiresAt: Date;
  userId?: number;
  username?: string;
  role?: string;
}

const sessions = new Map<string, Session>();

let _userService: UserService | null = null;

export function setUserService(us: UserService): void {
  _userService = us;
}

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

export function requireRole(role: string) {
  return async (c: Context, next: Next) => {
    const sessionId = getCookie(c, "session_id");
    if (!sessionId || !sessions.has(sessionId)) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    const session = sessions.get(sessionId)!;
    if (!session.authenticated || session.expiresAt < new Date()) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    if (session.role !== role && session.role !== "admin") {
      return c.json({ error: "Forbidden" }, 403);
    }
    session.expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await next();
  };
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

export async function loginWithUser(
  c: Context,
  username: string,
  password: string,
): Promise<UserOutput | null> {
  if (!_userService) return legacyLogin(c, password) ? null : null;

  const userCount = await _userService.userCount();

  if (userCount > 0) {
    const user = await _userService.authenticate(username, password);
    if (!user) return null;
    createSession(c, user);
    return user;
  }

  // No users in DB — fall back to legacy WEB_ADMIN_PASSWORD check
  if (legacyLogin(c, password)) {
    return { id: 0, username: "admin", role: "admin" };
  }
  return null;
}

function legacyLogin(c: Context, password: string): boolean {
  const adminPassword = process.env.WEB_ADMIN_PASSWORD;
  if (!adminPassword) return false;

  const passwordHash = createHash("sha256").update(password).digest();
  const adminHash = createHash("sha256").update(adminPassword).digest();

  if (timingSafeEqual(passwordHash, adminHash)) {
    createSession(c, { id: 0, username: "admin", role: "admin" });
    return true;
  }
  return false;
}

function createSession(c: Context, user: UserOutput): void {
  const newSessionId = generateSessionId();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const session: Session = {
    authenticated: true,
    createdAt: new Date(),
    expiresAt,
    userId: user.id,
    username: user.username,
    role: user.role,
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
}

// Keep legacy login() for backwards compatibility with existing auth.ts callers
export function login(c: Context, password: string): boolean {
  return legacyLogin(c, password);
}

export function logout(c: Context): void {
  const sessionId = getCookie(c, "session_id");
  if (sessionId) {
    sessions.delete(sessionId);
    deleteCookie(c, "session_id");
  }
}

export function isAuthenticated(c: Context): boolean {
  const session = c.get("session") as Session | undefined;
  return session?.authenticated ?? false;
}

export function getSessionRole(c: Context): string {
  const session = c.get("session") as Session | undefined;
  return session?.role ?? "viewer";
}

export function getSessionUser(c: Context): string {
  const session = c.get("session") as Session | undefined;
  return session?.username ?? "";
}

function cleanupSessions(): void {
  const now = new Date();
  for (const [sessionId, session] of sessions.entries()) {
    if (session.expiresAt < now) {
      sessions.delete(sessionId);
    }
  }
}

setInterval(cleanupSessions, 60 * 60 * 1000);
