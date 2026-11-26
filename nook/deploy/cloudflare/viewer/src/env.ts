export interface NookEnv {
  NOOK_BUCKET: R2Bucket;
  ASSETS: Fetcher;
  CF_VERSION_METADATA?: WorkerVersionMetadata;
  LLM_MODEL: string;
  VIEWER_SERVICES: string;
  GITHUB_REPOSITORY: string;
  GITHUB_WORKFLOW: string;
  GITHUB_REF: string;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
  /** localhost からのアクセスに限り Access 検証を省略する(wrangler dev 用)。 */
  ACCESS_DISABLED?: string;
  GOOGLE_API_KEY?: string;
  GITHUB_TOKEN?: string;
}

declare global {
  namespace Cloudflare {
    interface Env extends NookEnv {}
  }
}

export type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/** クライアントに status と detail をそのまま返すエラー。 */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
  ) {
    super(detail);
    this.name = "HttpError";
  }
}

export function requireSecret(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`Missing required secret: ${name}`);
  }
  return value;
}

export function logEvent(level: "info" | "warn" | "error", fields: Record<string, unknown>): void {
  const line = JSON.stringify(fields);
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.info(line);
  }
}
