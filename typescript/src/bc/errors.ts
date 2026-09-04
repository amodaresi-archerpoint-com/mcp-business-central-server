/**
 * Business Central wraps errors in an OData error envelope:
 *   { "error": { "code": "...", "message": "..." } }
 *
 * We surface a typed error so tool handlers can map BC-specific codes to
 * useful user-facing messages.
 */

export class BCError extends Error {
  public readonly status: number;
  public readonly code: string | undefined;
  public readonly bcMessage: string | undefined;
  public readonly raw: string;

  constructor(opts: {
    status: number;
    code?: string;
    message: string;
    bcMessage?: string;
    raw: string;
  }) {
    super(opts.message);
    this.name = "BCError";
    this.status = opts.status;
    this.code = opts.code;
    this.bcMessage = opts.bcMessage;
    this.raw = opts.raw;
  }
}

export function parseBCError(status: number, body: string): BCError {
  let code: string | undefined;
  let bcMessage: string | undefined;
  try {
    const parsed = JSON.parse(body) as {
      error?: { code?: string; message?: string | { value?: string } };
    };
    code = parsed.error?.code;
    const msg = parsed.error?.message;
    bcMessage = typeof msg === "string" ? msg : msg?.value;
  } catch {
    // Not JSON, fall through.
  }

  const summary = bcMessage
    ? `BC ${status}${code ? ` [${code}]` : ""}: ${bcMessage}`
    : `BC ${status}: ${body.slice(0, 300)}`;

  return new BCError({
    status,
    code,
    message: summary,
    bcMessage,
    raw: body,
  });
}
