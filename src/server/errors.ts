import "server-only";
import { NextResponse } from "next/server";

/** DAL error with an HTTP status; route handlers map it via `handleApiError`. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export const unauthorized = () => new ApiError(401, "Sign in required");
export const forbidden = (message = "You do not have permission to do that") =>
  new ApiError(403, message);
export const notFound = (what = "Resource") => new ApiError(404, `${what} not found`);
export const badRequest = (message: string) => new ApiError(400, message);

export function handleApiError(error: unknown): NextResponse {
  if (error instanceof ApiError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  console.error("Unhandled API error:", error);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}
