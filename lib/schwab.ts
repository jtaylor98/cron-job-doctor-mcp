import { kv } from "@vercel/kv";

const SCHWAB_TOKEN_URL = "https://api.schwabapi.com/v1/oauth/token";
const SCHWAB_AUTHORIZE_URL = "https://api.schwabapi.com/v1/oauth/authorize";
const KV_KEY = "schwab:tokens";

// Refresh a bit before actual 30-minute expiry so we never hand out a stale token.
const EARLY_REFRESH_BUFFER_MS = 60_000;

interface StoredTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number; // epoch ms
}

interface SchwabTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number; // seconds
  token_type: string;
  scope: string;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function basicAuthHeader(): string {
  const clientId = requireEnv("SCHWAB_CLIENT_ID");
  const clientSecret = requireEnv("SCHWAB_CLIENT_SECRET");
  const encoded = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  return `Basic ${encoded}`;
}

/** Builds the URL you visit once in a browser to link your Schwab account. */
export function buildAuthorizeUrl(): string {
  const clientId = requireEnv("SCHWAB_CLIENT_ID");
  const redirectUri = requireEnv("SCHWAB_REDIRECT_URI");

  const url = new URL(SCHWAB_AUTHORIZE_URL);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  return url.toString();
}

async function storeTokens(data: SchwabTokenResponse): Promise<StoredTokens> {
  const record: StoredTokens = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000 - EARLY_REFRESH_BUFFER_MS,
  };
  await kv.set(KV_KEY, record);
  return record;
}

/** One-time step: trade the authorization code from the OAuth redirect for tokens. */
export async function exchangeCodeForTokens(code: string): Promise<StoredTokens> {
  const redirectUri = requireEnv("SCHWAB_REDIRECT_URI");

  const res = await fetch(SCHWAB_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
  });

  if (!res.ok) {
    throw new Error(`Schwab code exchange failed (${res.status}): ${await res.text()}`);
  }

  const data = (await res.json()) as SchwabTokenResponse;
  return storeTokens(data);
}

async function refreshAccessToken(refreshToken: string): Promise<StoredTokens> {
  const res = await fetch(SCHWAB_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) {
    throw new Error(
      `Schwab token refresh failed (${res.status}): ${await res.text()}. ` +
        `If this says invalid_client or invalid_grant, the refresh token (valid 7 days) ` +
        `has likely expired -- revisit /api/schwab/authorize to relink your account.`
    );
  }

  const data = (await res.json()) as SchwabTokenResponse;
  return storeTokens(data);
}

/** Returns a valid access token, refreshing automatically if the cached one is stale. */
export async function getValidAccessToken(): Promise<string> {
  const stored = await kv.get<StoredTokens>(KV_KEY);

  if (!stored) {
    throw new Error(
      "No Schwab tokens on file. Visit /api/schwab/authorize once to link your account."
    );
  }

  if (Date.now() < stored.expires_at) {
    return stored.access_token;
  }

  const refreshed = await refreshAccessToken(stored.refresh_token);
  return refreshed.access_token;
}
