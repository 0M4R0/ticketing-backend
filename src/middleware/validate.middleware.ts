import { NextFunction, Request, Response } from "express";
import { ZodType } from "zod";

export function validate(schema: ZodType) {
  return (request: Request, response: Response, next: NextFunction): void => {
    const result = schema.safeParse({
      body: request.body,
      query: request.query,
      params: request.params,
    });

    if (!result.success) {
      response.status(400).json({
        error: "Validation failed",
        issues: result.error.issues.map((issue) => ({
          path: issue.path.length ? issue.path.join(".") : "request",
          message: issue.message,
        })),
      });
      return;
    }

    const parsed = result.data as {
      body?: unknown;
      query?: unknown;
      params?: unknown;
    };

    if (parsed.body !== undefined) request.body = parsed.body;
    if (parsed.query !== undefined) {
      Object.defineProperty(request, "query", {
        configurable: true,
        enumerable: true,
        value: parsed.query,
      });
    }
    if (parsed.params !== undefined) request.params = parsed.params as Request["params"];

    next();
  };
}
