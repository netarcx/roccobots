import { Hono } from "hono";
import { z } from "zod";

import {
  getSessionRole,
  getSessionUser,
  isAuthenticated,
  login,
  loginWithUser,
  logout,
} from "../../middleware/auth";

const authRouter = new Hono();

const loginSchema = z.object({
  username: z.string().optional(),
  password: z.string().min(1, "Password is required"),
});

authRouter.post("/login", async (c) => {
  try {
    const body = await c.req.json();
    const { username, password } = loginSchema.parse(body);

    // Try multi-user auth first, fall back to legacy
    const user = await loginWithUser(c, username ?? "admin", password);
    if (user) {
      return c.json({
        success: true,
        message: "Login successful",
        user: { username: user.username, role: user.role },
      });
    }

    // Legacy fallback for password-only login
    if (!username && login(c, password)) {
      return c.json({
        success: true,
        message: "Login successful",
        user: { username: "admin", role: "admin" },
      });
    }

    return c.json({ success: false, error: "Invalid credentials" }, 401);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json(
        { success: false, error: "Validation error", details: error.errors },
        400,
      );
    }
    return c.json({ success: false, error: "Login failed" }, 500);
  }
});

authRouter.post("/logout", async (c) => {
  logout(c);
  return c.json({ success: true, message: "Logout successful" });
});

authRouter.get("/status", async (c) => {
  const authenticated = isAuthenticated(c);
  return c.json({
    authenticated,
    role: authenticated ? getSessionRole(c) : null,
    username: authenticated ? getSessionUser(c) : null,
  });
});

export default authRouter;
