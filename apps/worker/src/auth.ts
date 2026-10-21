import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Env } from "./env.ts";

export const DEV_OWNER_ID = "dev-user";

export type AuthResult = { ok: true; ownerId: string; token: string; scopes: string[]; clientId: string } | { ok: false; response: Response };

const jwksByDomain = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function jwks(domain: string) {
  let set = jwksByDomain.get(domain);
  if (!set) {
    set = createRemoteJWKSet(new URL(`https://${domain}/oauth2/jwks`));
    jwksByDomain.set(domain, set);
  }
  return set;
}

export function baseUrl(env: Env): string {
  return env.PUBLIC_BASE_URL.replace(/\/+$/, "");
}

export function protectedResourceMetadata(env: Env) {
  return {
    resource: `${baseUrl(env)}/mcp`,
    authorization_servers: [`https://${env.AUTHKIT_DOMAIN}`],
    bearer_methods_supported: ["header"],
    resource_name: "Billy Quotes",
  };
}

export const PRM_PATH = "/.well-known/oauth-protected-resource";

function unauthorized(env: Env, error?: { code: "invalid_token"; description: string }): Response {
  const params = [`resource_metadata="${baseUrl(env)}${PRM_PATH}/mcp"`];
  if (error) params.push(`error="${error.code}"`, `error_description="${error.description}"`);
  return Response.json(
    { error: error?.code ?? "unauthorized", error_description: error?.description ?? "Sign in to use Billy Quotes." },
    { status: 401, headers: { "WWW-Authenticate": `Bearer ${params.join(", ")}` } },
  );
}

function sameSecret(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  if (left.byteLength !== right.byteLength) return false;
  return crypto.subtle.timingSafeEqual(left, right);
}

export async function authenticate(request: Request, env: Env): Promise<AuthResult> {
  const header = request.headers.get("Authorization") ?? "";
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  if (!match?.[1]) return { ok: false, response: unauthorized(env) };
  const token = match[1];

  if (env.DEV_AUTH_TOKEN && sameSecret(token, env.DEV_AUTH_TOKEN)) {
    return { ok: true, ownerId: DEV_OWNER_ID, token, scopes: [], clientId: "dev" };
  }

  try {
    const { payload } = await jwtVerify(token, jwks(env.AUTHKIT_DOMAIN), { issuer: `https://${env.AUTHKIT_DOMAIN}` });
    if (!payload.sub) throw new Error("token has no subject");
    const scopes = typeof payload.scope === "string" ? payload.scope.split(" ").filter(Boolean) : [];
    const clientId = typeof payload.client_id === "string" ? payload.client_id : typeof payload.azp === "string" ? payload.azp : "unknown";
    return { ok: true, ownerId: payload.sub, token, scopes, clientId };
  } catch {
    return { ok: false, response: unauthorized(env, { code: "invalid_token", description: "The access token is invalid or expired." }) };
  }
}
