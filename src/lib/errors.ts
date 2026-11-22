export class AppError extends Error {
  constructor(public code: string, message?: string, public status = 400, public details?: unknown) {
    super(message ?? code);
  }
}
export const notFound = (what = "resource") => new AppError("not_found", `${what} not found`, 404);
export const forbidden = () => new AppError("forbidden", "You do not have permission to do this", 403);
export const unauthorized = () => new AppError("unauthorized", "Sign in required", 401);
