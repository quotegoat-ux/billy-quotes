import { createMcpHandler } from "@modelcontextprotocol/server";
import { PRM_PATH, authenticate, protectedResourceMetadata } from "./auth.ts";
import type { Env } from "./env.ts";
import { createMcpServer } from "./mcp.ts";
import { notFound, respond, sameOrigin, showQuote } from "./public.ts";
import { QuoteStore } from "./store.ts";
import { handlePay, handleWebhook } from "./stripe.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID",
  "Access-Control-Expose-Headers": "WWW-Authenticate, Mcp-Session-Id",
  "Access-Control-Max-Age": "86400",
};

function withCors(response: Response): Response {
  const out = new Response(response.body, response);
  for (const [k, v] of Object.entries(CORS)) out.headers.set(k, v);
  return out;
}

async function handleMcp(request: Request, env: Env): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (request.method !== "POST") {
    return withCors(new Response("Method not allowed. This server is stateless; use POST.", { status: 405, headers: { Allow: "POST, OPTIONS" } }));
  }
  const auth = await authenticate(request, env);
  if (!auth.ok) return withCors(auth.response);
  const store = new QuoteStore(env.DB);
  const handler = createMcpHandler(() => createMcpServer({ store, ownerId: auth.ownerId, env, now: () => new Date() }), {
    legacy: "stateless",
  });
  const response = await handler.fetch(request, {
    authInfo: { token: auth.token, clientId: auth.clientId, scopes: auth.scopes, extra: { ownerId: auth.ownerId } },
  });
  return withCors(response);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const now = new Date();

    if (path === "/mcp") return handleMcp(request, env);

    if (path === PRM_PATH || path === `${PRM_PATH}/mcp`) {
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
      return withCors(Response.json(protectedResourceMetadata(env)));
    }

    if (path === "/stripe/webhook" && request.method === "POST") {
      return handleWebhook(request, env, new QuoteStore(env.DB), now);
    }

    const quotePage = /^\/q\/([A-Za-z0-9_-]+)(?:\/(accept|decline))?$/.exec(path);
    if (quotePage?.[1]) {
      const [, token, action] = quotePage;
      const store = new QuoteStore(env.DB);
      if (!action && request.method === "GET") return showQuote(token, env, store, now);
      if ((action === "accept" || action === "decline") && request.method === "POST") {
        if (!sameOrigin(request, env)) return new Response("Forbidden", { status: 403 });
        return respond(token, action, env, store, now);
      }
      return new Response("Method not allowed", { status: 405 });
    }

    const payPage = /^\/pay\/([A-Za-z0-9_-]+)$/.exec(path);
    if (payPage?.[1]) {
      if (request.method !== "GET" && request.method !== "POST") return new Response("Method not allowed", { status: 405 });
      return handlePay(request, payPage[1], env, new QuoteStore(env.DB), now);
    }

    if (path === "/") return new Response("Billy Quotes MCP server. Connect an MCP client to /mcp.\n");
    return notFound();
  },
} satisfies ExportedHandler<Env>;
