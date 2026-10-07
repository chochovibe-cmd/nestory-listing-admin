import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes
} from "node:crypto";
import type { createServiceSupabaseClient } from "@/lib/supabase/server";

type ServiceSupabase = ReturnType<typeof createServiceSupabaseClient>;

export const YOUTUBE_UPLOAD_SCOPE =
  "https://www.googleapis.com/auth/youtube.upload";

const TOKEN_SETTING_KEY = "youtube_oauth_refresh_token_v1";
const TOKEN_AAD = Buffer.from("nestory:youtube-refresh-token:v1", "utf8");

type StoredTokenValue = {
  version: 1;
  ciphertext: string;
  scope: string;
  connected_at: string;
};

type GoogleTokenResponse = {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
};

export type YouTubeIntegrationStatus = {
  envConfigured: boolean;
  connected: boolean;
  connectedAt: string | null;
  missingEnv: string[];
  scope: string;
};

function env(name: string): string {
  return process.env[name]?.trim() ?? "";
}

export function getYouTubeOAuthEnvStatus() {
  const required = [
    "YOUTUBE_OAUTH_CLIENT_ID",
    "YOUTUBE_OAUTH_CLIENT_SECRET",
    "YOUTUBE_OAUTH_REDIRECT_URI",
    "YOUTUBE_TOKEN_ENCRYPTION_KEY"
  ] as const;
  const missing = required.filter((name) => !env(name));
  return {
    configured: missing.length === 0,
    missing
  };
}

function encryptionKey(): Buffer {
  const secret = env("YOUTUBE_TOKEN_ENCRYPTION_KEY");
  if (!secret) throw new Error("YOUTUBE_TOKEN_ENCRYPTION_KEY is not configured");
  return createHash("sha256").update(secret, "utf8").digest();
}

function encryptRefreshToken(refreshToken: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(TOKEN_AAD);
  const encrypted = Buffer.concat([
    cipher.update(refreshToken, "utf8"),
    cipher.final()
  ]);
  const tag = cipher.getAuthTag();
  return [
    "v1",
    iv.toString("base64url"),
    tag.toString("base64url"),
    encrypted.toString("base64url")
  ].join(".");
}

function decryptRefreshToken(payload: string): string {
  const [version, ivRaw, tagRaw, encryptedRaw] = payload.split(".");
  if (version !== "v1" || !ivRaw || !tagRaw || !encryptedRaw) {
    throw new Error("Stored YouTube OAuth token format is invalid");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(ivRaw, "base64url")
  );
  decipher.setAAD(TOKEN_AAD);
  decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedRaw, "base64url")),
    decipher.final()
  ]);
  return decrypted.toString("utf8");
}

function assertOAuthEnv() {
  const status = getYouTubeOAuthEnvStatus();
  if (!status.configured) {
    throw new Error(
      `YouTube OAuth server settings are incomplete: ${status.missing.join(", ")}`
    );
  }
}

export function buildYouTubeAuthorizeUrl(state: string): string {
  assertOAuthEnv();
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", env("YOUTUBE_OAUTH_CLIENT_ID"));
  url.searchParams.set("redirect_uri", env("YOUTUBE_OAUTH_REDIRECT_URI"));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", YOUTUBE_UPLOAD_SCOPE);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);
  return url.toString();
}

async function parseTokenResponse(response: Response): Promise<GoogleTokenResponse> {
  const data = (await response.json().catch(() => ({}))) as GoogleTokenResponse;
  if (!response.ok || data.error) {
    const detail = data.error_description || data.error || `HTTP ${response.status}`;
    throw new Error(`Google OAuth token exchange failed: ${detail}`);
  }
  return data;
}

export async function exchangeYouTubeAuthorizationCode(
  code: string
): Promise<{ refreshToken: string; scope: string }> {
  assertOAuthEnv();
  const body = new URLSearchParams({
    code,
    client_id: env("YOUTUBE_OAUTH_CLIENT_ID"),
    client_secret: env("YOUTUBE_OAUTH_CLIENT_SECRET"),
    redirect_uri: env("YOUTUBE_OAUTH_REDIRECT_URI"),
    grant_type: "authorization_code"
  });
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store"
  });
  const data = await parseTokenResponse(response);
  if (!data.refresh_token) {
    throw new Error(
      "Google did not return a refresh token. Reconnect and complete the consent screen again."
    );
  }
  return {
    refreshToken: data.refresh_token,
    scope: data.scope || YOUTUBE_UPLOAD_SCOPE
  };
}

export async function saveYouTubeRefreshToken(
  serviceSupabase: ServiceSupabase,
  input: { refreshToken: string; scope?: string; userId: string }
): Promise<void> {
  const connectedAt = new Date().toISOString();
  const value: StoredTokenValue = {
    version: 1,
    ciphertext: encryptRefreshToken(input.refreshToken),
    scope: input.scope || YOUTUBE_UPLOAD_SCOPE,
    connected_at: connectedAt
  };
  const { error } = await serviceSupabase.from("team_settings").upsert(
    {
      key: TOKEN_SETTING_KEY,
      value,
      updated_by: input.userId
    },
    { onConflict: "key" }
  );
  if (error) throw new Error(`Unable to persist YouTube OAuth token: ${error.message}`);
}

async function readStoredTokenValue(
  serviceSupabase: ServiceSupabase
): Promise<StoredTokenValue | null> {
  const { data, error } = await serviceSupabase
    .from("team_settings")
    .select("value")
    .eq("key", TOKEN_SETTING_KEY)
    .maybeSingle();
  if (error) throw new Error(`Unable to read YouTube integration: ${error.message}`);
  const value = data?.value as Partial<StoredTokenValue> | null | undefined;
  if (
    !value ||
    value.version !== 1 ||
    typeof value.ciphertext !== "string" ||
    typeof value.connected_at !== "string"
  ) {
    return null;
  }
  return value as StoredTokenValue;
}

export async function readYouTubeIntegrationStatus(
  serviceSupabase: ServiceSupabase
): Promise<YouTubeIntegrationStatus> {
  const envStatus = getYouTubeOAuthEnvStatus();
  let stored: StoredTokenValue | null = null;
  try {
    stored = await readStoredTokenValue(serviceSupabase);
  } catch {
    stored = null;
  }
  return {
    envConfigured: envStatus.configured,
    connected: Boolean(stored?.ciphertext),
    connectedAt: stored?.connected_at ?? null,
    missingEnv: [...envStatus.missing],
    scope: stored?.scope || YOUTUBE_UPLOAD_SCOPE
  };
}

async function loadRefreshToken(serviceSupabase: ServiceSupabase): Promise<string> {
  const stored = await readStoredTokenValue(serviceSupabase);
  if (!stored) throw new Error("YouTube is not connected in Nestory settings");
  return decryptRefreshToken(stored.ciphertext);
}

export async function getYouTubeAccessToken(
  serviceSupabase: ServiceSupabase
): Promise<string> {
  assertOAuthEnv();
  const refreshToken = await loadRefreshToken(serviceSupabase);
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env("YOUTUBE_OAUTH_CLIENT_ID"),
      client_secret: env("YOUTUBE_OAUTH_CLIENT_SECRET"),
      refresh_token: refreshToken,
      grant_type: "refresh_token"
    }),
    cache: "no-store"
  });
  const data = await parseTokenResponse(response);
  if (!data.access_token) {
    throw new Error("Google OAuth refresh response did not include an access token");
  }
  return data.access_token;
}

export async function disconnectYouTube(
  serviceSupabase: ServiceSupabase
): Promise<{ revoked: boolean }> {
  let revoked = false;
  try {
    const refreshToken = await loadRefreshToken(serviceSupabase);
    const revokeResponse = await fetch("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: refreshToken }),
      cache: "no-store"
    });
    revoked = revokeResponse.ok;
  } catch {
    // Local disconnect still works if Google is unreachable/token already invalid.
  }

  const { error } = await serviceSupabase
    .from("team_settings")
    .delete()
    .eq("key", TOKEN_SETTING_KEY);
  if (error) throw new Error(`Unable to disconnect YouTube: ${error.message}`);
  return { revoked };
}
