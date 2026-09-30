import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth/roles";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  buildYouTubeAuthorizeUrl,
  getYouTubeOAuthEnvStatus
} from "@/lib/youtube/oauth";
import type { UserRole } from "@/types/domain";

export const runtime = "nodejs";

function settingsRedirect(request: NextRequest, code: string) {
  const url = new URL("/settings", request.url);
  url.searchParams.set("section", "connection");
  url.searchParams.set("youtube", code);
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
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
    return settingsRedirect(request, "admin_required");
  }

  const envStatus = getYouTubeOAuthEnvStatus();
  if (!envStatus.configured) {
    return settingsRedirect(request, "env_missing");
  }

  const state = randomBytes(24).toString("base64url");
  const response = NextResponse.redirect(buildYouTubeAuthorizeUrl(state));
  response.cookies.set("nestory_youtube_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 10 * 60,
    path: "/"
  });
  return response;
}
