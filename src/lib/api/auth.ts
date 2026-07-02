import { AppError } from "@/lib/errors";

export function bearerToken(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!authorization) {
    throw new AppError(401, "Bearer telemetry token required");
  }

  const [scheme, token] = authorization.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    throw new AppError(401, "Bearer telemetry token required");
  }

  return token;
}
