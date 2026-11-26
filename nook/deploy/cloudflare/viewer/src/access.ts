import { createRemoteJWKSet, jwtVerify } from "jose";

import { logEvent, type NookEnv } from "./env";

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);
const jwksByIssuer = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

/**
 * Cloudflare Access が付ける JWT(Cf-Access-Jwt-Assertion)を検証する。
 * Access の設定漏れで Worker が素通しにならないよう、未設定なら拒否する。
 */
export async function verifyAccessJwt(
  request: Request,
  env: Pick<NookEnv, "ACCESS_TEAM_DOMAIN" | "ACCESS_AUD" | "ACCESS_DISABLED">,
): Promise<boolean> {
  if (env.ACCESS_DISABLED === "true" && LOCAL_HOSTNAMES.has(new URL(request.url).hostname)) {
    return true;
  }
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) {
    logEvent("error", { event: "access_not_configured" });
    return false;
  }
  const token = request.headers.get("cf-access-jwt-assertion");
  if (!token) {
    logEvent("warn", { event: "access_token_missing", path: new URL(request.url).pathname });
    return false;
  }

  const issuer = `https://${normalizeTeamDomain(env.ACCESS_TEAM_DOMAIN)}`;
  try {
    await jwtVerify(token, jwksFor(issuer), { issuer, audience: env.ACCESS_AUD });
    return true;
  } catch (error) {
    logEvent("warn", { event: "access_token_invalid", error: String(error) });
    return false;
  }
}

function normalizeTeamDomain(teamDomain: string): string {
  const host = teamDomain.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return host.includes(".") ? host : `${host}.cloudflareaccess.com`;
}

function jwksFor(issuer: string): ReturnType<typeof createRemoteJWKSet> {
  const cached = jwksByIssuer.get(issuer);
  if (cached) {
    return cached;
  }
  const jwks = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
  jwksByIssuer.set(issuer, jwks);
  return jwks;
}
