import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

import { DBType, Schema } from "db";
import { eq } from "drizzle-orm";

export interface UserOutput {
  id: number;
  username: string;
  role: string;
}

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const hashBuf = Buffer.from(hash, "hex");
  const derivedBuf = scryptSync(password, salt, 64);
  return timingSafeEqual(hashBuf, derivedBuf);
}

export class UserService {
  private db: DBType;

  constructor(db: DBType) {
    this.db = db;
  }

  async createUser(
    username: string,
    password: string,
    role: "admin" | "viewer",
  ): Promise<UserOutput> {
    const passwordHash = hashPassword(password);
    const now = new Date();
    const result = await this.db
      .insert(Schema.Users)
      .values({ username, passwordHash, role, createdAt: now, updatedAt: now })
      .returning();
    const user = result[0];
    return { id: user.id, username: user.username, role: user.role };
  }

  async authenticate(
    username: string,
    password: string,
  ): Promise<UserOutput | null> {
    const user = await this.db
      .select()
      .from(Schema.Users)
      .where(eq(Schema.Users.username, username))
      .get();
    if (!user) return null;
    if (!verifyPassword(password, user.passwordHash)) return null;
    return { id: user.id, username: user.username, role: user.role };
  }

  async getAllUsers(): Promise<UserOutput[]> {
    const rows = await this.db.select().from(Schema.Users).all();
    return rows.map((r) => ({
      id: r.id,
      username: r.username,
      role: r.role,
    }));
  }

  async getUserById(id: number): Promise<UserOutput | null> {
    const user = await this.db
      .select()
      .from(Schema.Users)
      .where(eq(Schema.Users.id, id))
      .get();
    if (!user) return null;
    return { id: user.id, username: user.username, role: user.role };
  }

  async updateUserRole(id: number, role: "admin" | "viewer"): Promise<void> {
    await this.db
      .update(Schema.Users)
      .set({ role, updatedAt: new Date() })
      .where(eq(Schema.Users.id, id));
  }

  async changePassword(id: number, newPassword: string): Promise<void> {
    const passwordHash = hashPassword(newPassword);
    await this.db
      .update(Schema.Users)
      .set({ passwordHash, updatedAt: new Date() })
      .where(eq(Schema.Users.id, id));
  }

  async deleteUser(id: number): Promise<void> {
    await this.db.delete(Schema.Users).where(eq(Schema.Users.id, id));
  }

  async userCount(): Promise<number> {
    const rows = await this.db.select().from(Schema.Users).all();
    return rows.length;
  }

  async bootstrapFromEnv(adminPassword: string): Promise<void> {
    const count = await this.userCount();
    if (count > 0) return;
    await this.createUser("admin", adminPassword, "admin");
    console.log("Created default admin user from WEB_ADMIN_PASSWORD");
  }
}
