import type { Config } from "../../config.js";
import { BasicAuthProvider } from "./basic.js";
import { OAuthClientCredentialsProvider } from "./oauth.js";

export interface AuthProvider {
  /** Returns the full Authorization header value, e.g. "Bearer xyz" or "Basic xyz". */
  getAuthHeader(): Promise<string>;
}

export function createAuthProvider(config: Config): AuthProvider {
  if (config.authType === "oauth_client_credentials") {
    return new OAuthClientCredentialsProvider(
      config.tenantId,
      config.clientId,
      config.clientSecret,
      config.scope,
    );
  }
  return new BasicAuthProvider(config.username, config.password);
}
