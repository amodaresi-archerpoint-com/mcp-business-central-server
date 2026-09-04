import { request } from "undici";
import type { AuthProvider } from "./types.js";

interface CachedToken {
  token: string;
  expiresAt: number; // epoch ms
}

export class OAuthClientCredentialsProvider implements AuthProvider {
  private cache: CachedToken | null = null;
  private inFlight: Promise<string> | null = null;

  constructor(
    private readonly tenantId: string,
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly scope: string,
  ) {}

  async getAuthHeader(): Promise<string> {
    const token = await this.getToken();
    return `Bearer ${token}`;
  }

  private async getToken(): Promise<string> {
    // Refresh 60s before actual expiry to avoid edge-case 401s.
    const now = Date.now();
    if (this.cache && this.cache.expiresAt - 60_000 > now) {
      return this.cache.token;
    }
    // Coalesce concurrent refreshes.
    if (this.inFlight) return this.inFlight;

    this.inFlight = this.fetchToken().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async fetchToken(): Promise<string> {
    const url = `https://login.microsoftonline.com/${encodeURIComponent(
      this.tenantId,
    )}/oauth2/v2.0/token`;

    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.clientId,
      client_secret: this.clientSecret,
      scope: this.scope,
    });

    const res = await request(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    const text = await res.body.text();
    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw new Error(
        `OAuth token request failed (${res.statusCode}): ${text.slice(0, 500)}`,
      );
    }

    const json = JSON.parse(text) as {
      access_token: string;
      expires_in: number;
      token_type: string;
    };

    this.cache = {
      token: json.access_token,
      expiresAt: Date.now() + json.expires_in * 1000,
    };
    return json.access_token;
  }
}
