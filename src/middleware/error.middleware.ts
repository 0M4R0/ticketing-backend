import { NextFunction, Request, Response } from "express";
import { AppError } from "../utils/errors";

export function errorHandler(
  error: unknown,
  _request: Request,
  response: Response,
  _next: NextFunction,
): void {
  if (isMalformedJson(error)) {
    response.status(400).json({ error: "Malformed JSON request body" });
    return;
  }

  if (error instanceof AppError) {
    response.status(error.status).json({ error: error.message });
    return;
  }

  response.status(500).json({ error: "Internal server error" });
}

function isMalformedJson(error: unknown): error is SyntaxError & { status: number } {
  return (
    error instanceof SyntaxError &&
    "status" in error &&
    error.status === 400 &&
    "body" in error
  );
}
