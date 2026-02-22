import { Hono } from "hono";
import { z } from "zod";

import { isAuthenticated, login, logout } from "../../middleware/auth";

const authRouter = new Hono();

// Login schema
const loginSchema = z.object({
  password: z.string().min(1, "Password is required"),
});

/**
 * POST /api/auth/login
 * Login with admin password
 */
authRouter.post("/login", async (c) => {
  try {
    const body = await c.req.json();
    const { password } = loginSchema.parse(body);

    const success = login(c, password);

    if (success) {
      return c.json({
        success: true,
        message: "Login successful",
      });
    } else {
      return c.json(
        {
          success: false,
          error: "Invalid password",
        },
        401,
      );
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json(
        {
          success: false,
          error: "Validation error",
          details: error.errors,
        },
        400,
      );
    }

    return c.json(
      {
        success: false,
        error: "Login failed",
      },
      500,
    );
  }
});

/**
 * POST /api/auth/logout
 * Logout current user
 */
authRouter.post("/logout", async (c) => {
  logout(c);
  return c.json({
    success: true,
    message: "Logout successful",
  });
});

/**
 * GET /api/auth/status
 * Check authentication status
 */
authRouter.get("/status", async (c) => {
  const authenticated = isAuthenticated(c);

  return c.json({
    authenticated,
  });
});

export default authRouter;
