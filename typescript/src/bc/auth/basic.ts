import type { AuthProvider } from "./types.js";

export class BasicAuthProvider implements AuthProvider {
  private readonly headerValue: string;

  constructor(username: string, password: string) {
    const encoded = Buffer.from(`${username}:${password}`, "utf-8").toString(
      "base64",
    );
    this.headerValue = `Basic ${encoded}`;
  }

  async getAuthHeader(): Promise<string> {
    return this.headerValue;
  }
}
