import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { isAppError } from "@/lib/errors";

function withNoStore(init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  if (!headers.has("Cache-Control")) {
    headers.set("Cache-Control", "no-store");
  }
  return { ...init, headers };
}

export function ok<T>(body: T, init?: ResponseInit) {
  return NextResponse.json(body, withNoStore(init));
}

export function handleApiError(error: unknown) {
  if (isAppError(error)) {
    return NextResponse.json(
      { detail: error.message },
      withNoStore({ status: error.status }),
    );
  }

  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        detail: error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
      withNoStore({ status: 422 }),
    );
  }

  console.error(error);
  return NextResponse.json(
    { detail: "Internal server error" },
    withNoStore({ status: 500 }),
  );
}

export async function readJson(request: Request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}
