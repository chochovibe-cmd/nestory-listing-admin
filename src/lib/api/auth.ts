import { NextRequest } from "next/server";

export function requireWorkerToken(request: NextRequest) {
  const expected = process.env.WORKER_API_TOKEN;
  const actual = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");

  if (!expected) {
    return { ok: false as const, error: "WORKER_API_TOKEN is not configured" };
  }

  if (!actual || actual !== expected) {
    return { ok: false as const, error: "Invalid worker token" };
  }

  return { ok: true as const };
}

export function jsonError(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}
