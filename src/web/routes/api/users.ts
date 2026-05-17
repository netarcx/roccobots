import { Hono } from "hono";
import { z } from "zod";

import { requireRole } from "../../middleware/auth";
import { UserService } from "../../services/user-service";

const usersRouter = new Hono<{
  Variables: {
    userService: UserService;
  };
}>();

usersRouter.use("*", requireRole("admin"));

const createUserSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(6),
  role: z.enum(["admin", "viewer"]),
});

const updateUserSchema = z.object({
  role: z.enum(["admin", "viewer"]).optional(),
  password: z.string().min(6).optional(),
});

usersRouter.get("/", async (c) => {
  const userService = c.get("userService");
  const users = await userService.getAllUsers();
  return c.json({ users });
});

usersRouter.post("/", async (c) => {
  const userService = c.get("userService");
  try {
    const body = await c.req.json();
    const { username, password, role } = createUserSchema.parse(body);
    const user = await userService.createUser(username, password, role);
    return c.json({ user }, 201);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({ error: "Validation error", details: error.errors }, 400);
    }
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("UNIQUE")) {
      return c.json({ error: "Username already exists" }, 409);
    }
    return c.json({ error: "Failed to create user" }, 500);
  }
});

usersRouter.put("/:id", async (c) => {
  const userService = c.get("userService");
  const id = parseInt(c.req.param("id"));
  if (isNaN(id)) return c.json({ error: "Invalid ID" }, 400);

  try {
    const body = await c.req.json();
    const { role, password } = updateUserSchema.parse(body);
    if (role) await userService.updateUserRole(id, role);
    if (password) await userService.changePassword(id, password);
    const user = await userService.getUserById(id);
    return c.json({ user });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({ error: "Validation error", details: error.errors }, 400);
    }
    return c.json({ error: "Failed to update user" }, 500);
  }
});

usersRouter.delete("/:id", async (c) => {
  const userService = c.get("userService");
  const id = parseInt(c.req.param("id"));
  if (isNaN(id)) return c.json({ error: "Invalid ID" }, 400);

  await userService.deleteUser(id);
  return c.json({ success: true });
});

export default usersRouter;
