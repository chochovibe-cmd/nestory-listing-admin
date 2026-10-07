import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth/roles";
import {
  createServerSupabaseClient,
  createServiceSupabaseClient
} from "@/lib/supabase/server";
import {
  exchangeYouTubeAuthorizationCode,
  saveYouTubeRefreshToken
} from "@/lib/youtube/oauth";
import type { UserRole } from "@/types/domain";

export const runtime = "nodejs";

function redirectResult(request: NextRequest, code: string) {
  const url = new URL("/settings", request.url);
  url.searchParams.set("section", "connection");
  url.searchParams.set("youtube", code);
  const response = NextResponse.redirect(url);
  response.cookies.set("nestory_youtube_oauth_state", "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 0,
    path: "/"
  });
  return response;
}

function safeStateEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: NextRequest) {
  const oauthError = request.nextUrl.searchParams.get("error");
  if (oauthError) return redirectResult(request, "denied");

  const code = request.nextUrl.searchParams.get("code") ?? "";
  const state = request.nextUrl.searchParams.get("state") ?? "";
  const expectedState = request.cookies.get("nestory_youtube_oauth_state")?.value ?? "";
  if (!code || !state || !expectedState || !safeStateEqual(state, expectedState)) {
    return redirectResult(request, "state_error");
  }

  const authSupabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await authSupabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));

  const { data: profile } = await authSupabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (!isAdmin(profile?.role as UserRole | undefined)) {
    return redirectResult(request, "admin_required");
  }

  try {
    const token = await exchangeYouTubeAuthorizationCode(code);
    await saveYouTubeRefreshToken(createServiceSupabaseClient(), {
      refreshToken: token.refreshToken,
      scope: token.scope,
      userId: user.id
    });
    return redirectResult(request, "connected");
  } catch {
    return redirectResult(request, "connect_failed");
  }
}
