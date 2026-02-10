import { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";

/**
 * Global error handling middleware
 */
export async function errorHandler(c: Context, next: Next) {
  try {
    await next();
  } catch (error) {
    console.error("Error:", error);

    if (error instanceof HTTPException) {
      return c.json(
        {
          error: error.message,
          status: error.status,
        },
        error.status,
      );
    }

    if (error instanceof Error) {
      return c.json(
        {
          error: error.message,
          status: 500,
        },
        500,
      );
    }

    return c.json(
      {
        error: "Internal server error",
        status: 500,
      },
      500,
    );
  }
}
