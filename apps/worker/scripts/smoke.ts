/**
 * Drives a running worker end to end over Streamable HTTP, once per protocol
 * era (2025 handshake, as ChatGPT and Claude use today, and the 2026-07-28
 * per-request envelope), plus the public quote page and the Stripe webhook.
 *
 *   pnpm --filter @billy/worker dev            # in one terminal
 *   DEV_AUTH_TOKEN=... pnpm --filter @billy/worker smoke
 */
import { Client, StreamableHTTPClientTransport, type CallToolResult } from "@modelcontextprotocol/client";
import { strict as assert } from "node:assert";
import { createHmac } from "node:crypto";

const BASE = (process.env.SMOKE_URL ?? "http://localhost:8787").replace(/\/$/, "");
const TOKEN = process.env.DEV_AUTH_TOKEN;
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
assert(TOKEN, "set DEV_AUTH_TOKEN to the value in apps/worker/.dev.vars");

const log = (label: string, detail = "") => console.log(`ok  ${label}${detail ? `  ${detail}` : ""}`);

type QuoteSC = { quote: { id: string; number: string; version: number; status: string; items: Array<{ id: string; description: string }>; totals: { subtotal: number; total: number; amountDue: number }; links?: { quote: string; pay: string }; publicToken: string } };

function quoteOf(result: CallToolResult): QuoteSC["quote"] {
  assert(!result.isError, `tool failed: ${JSON.stringify(result.content)}`);
  const sc = result.structuredContent as QuoteSC | undefined;
  assert(sc?.quote?.number, "structuredContent.quote present");
  assert(result.content.some((c) => c.type === "text" && c.text.includes(sc.quote.number)), "text summary names the quote");
  return sc.quote;
}

async function connect(mode: "legacy" | "auto") {
  const client = new Client({ name: "billy-smoke", version: "1.0.0" }, { versionNegotiation: { mode } });
  const transport = new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
  });
  await client.connect(transport);
  return client;
}

async function runEra(mode: "legacy" | "auto"): Promise<{ token: string; id: string }> {
  const client = await connect(mode);
  const era = `[${mode}, protocol ${client.getNegotiatedProtocolVersion() ?? "?"}]`;
  log(`connected ${era}`);

  const { tools } = await client.listTools();
  const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
  assert.deepEqual(Object.keys(byName).sort(), ["create_quote", "price_lookup", "quote_status", "revise_quote", "send_quote"]);
  for (const name of ["create_quote", "revise_quote", "quote_status", "send_quote"]) {
    const meta = byName[name]?._meta as Record<string, unknown> & { ui?: { resourceUri?: string } };
    assert.equal(meta.ui?.resourceUri, "ui://billy/quote-card.html", `${name} links the card`);
    assert.equal(meta["openai/outputTemplate"], "ui://billy/quote-card.html", `${name} legacy outputTemplate`);
    assert.equal(meta["openai/widgetAccessible"], true);
  }
  assert.deepEqual((byName.create_quote?._meta as Record<string, unknown>)["openai/fileParams"], ["source_file"]);
  assert.equal(byName.quote_status?.annotations?.readOnlyHint, true);
  assert.equal(byName.price_lookup?.annotations?.readOnlyHint, true);
  assert.equal(byName.revise_quote?.annotations?.idempotentHint, true);
  log("tools/list", tools.map((t) => t.name).join(", "));

  const created = quoteOf(
    (await client.callTool({
      name: "create_quote",
      arguments: {
        title: "Wedding reception catering",
        customer: { name: "Okafor-Lindqvist wedding", email: "events@example.com" },
        items: [
          { description: "Plated dinner, 3 courses", quantity: 120, unit: "guest", unit_price: 48.5 },
          { description: "Bar service", quantity: 4.5, unit: "hr", unit_price: 175 },
          { description: "Cake cutting", quantity: 120, unit: "guest", unit_price: 1.25 },
        ],
        tax_percent: 6.35,
        deposit_percent: 25,
        source_name: "event-brief.pdf",
      },
    })) as CallToolResult,
  );
  assert.equal(created.status, "draft");
  assert.deepEqual(created.totals, { subtotal: 675750, discount: 0, tax: 42910, total: 718660, amountDue: 179665 });
  assert.equal(created.links, undefined, "a draft has no public links");
  log("create_quote", `${created.number} total $${created.totals.total / 100}, due $${created.totals.amountDue / 100}`);

  const burst = await Promise.all(
    [1, 2, 3, 4].map((n) =>
      client.callTool({
        name: "create_quote",
        arguments: { title: `Burst ${n}`, customer: { name: "Load test" }, items: [{ description: "Widget", quantity: n, unit_price: 9.99 }] },
      }),
    ),
  );
  const numbers = burst.map((r) => quoteOf(r as CallToolResult).number);
  assert.equal(new Set(numbers).size, 4, `concurrent creates get distinct numbers: ${numbers.join(", ")}`);
  log("concurrent create_quote", numbers.join(", "));

  const bar = created.items.find((i) => i.description === "Bar service");
  assert(bar);
  const reviseArgs = {
    quote: created.number,
    ops: [
      { op: "update_item", item_id: bar.id, quantity: 5 },
      { op: "add_item", description: "Late-night snack station", quantity: 120, unit: "guest", unit_price: 6 },
    ],
  };
  const revised = quoteOf((await client.callTool({ name: "revise_quote", arguments: reviseArgs })) as CallToolResult);
  assert.equal(revised.items.length, 4);
  assert.equal(revised.totals.subtotal, 675750 + 8750 + 72000);
  const again = quoteOf((await client.callTool({ name: "revise_quote", arguments: reviseArgs })) as CallToolResult);
  assert.deepEqual(again.items, revised.items, "replaying the same ops changes nothing");
  log("revise_quote", `subtotal $${revised.totals.subtotal / 100}; replay is a no-op`);

  const bad = (await client.callTool({ name: "revise_quote", arguments: { quote: created.number, ops: [{ op: "remove_item" }] } })) as CallToolResult;
  assert.equal(bad.isError, true, "schema rejects a malformed op");
  log("revise_quote rejects malformed input");

  const prices = (await client.callTool({ name: "price_lookup", arguments: { query: "bar" } })) as CallToolResult;
  const matches = (prices.structuredContent as { matches: Array<{ description: string; last: number; count: number }> }).matches;
  const barStat = matches.find((m) => m.description === "Bar service");
  assert(barStat && barStat.last === 175 && barStat.count >= 1, "price_lookup finds past bar service");
  log("price_lookup", JSON.stringify(barStat));

  const sent = quoteOf((await client.callTool({ name: "send_quote", arguments: { quote: created.id } })) as CallToolResult);
  assert.equal(sent.status, "sent");
  assert(sent.links, "send returns links");
  assert.equal(sent.links.quote, `${BASE}/q/${sent.publicToken}`);
  assert.equal(sent.links.pay, `${BASE}/pay/${sent.publicToken}`);
  const resent = quoteOf((await client.callTool({ name: "send_quote", arguments: { quote: created.id } })) as CallToolResult);
  assert.deepEqual(resent.links, sent.links, "sending twice returns the same links");
  log("send_quote", sent.links.quote);

  const back = quoteOf(
    (await client.callTool({ name: "revise_quote", arguments: { quote: created.number, ops: [{ op: "set_notes", notes: "Includes setup and cleanup." }] } })) as CallToolResult,
  );
  assert.equal(back.status, "draft");
  assert.equal(back.version, 2);
  const resend = quoteOf((await client.callTool({ name: "send_quote", arguments: { quote: created.id } })) as CallToolResult);
  assert.equal(resend.status, "sent");
  log("revise of a sent quote", `back to draft as v${back.version}, sent again`);

  const one = quoteOf((await client.callTool({ name: "quote_status", arguments: { quote: created.number } })) as CallToolResult);
  assert.equal(one.status, "sent");
  const listed = (await client.callTool({ name: "quote_status", arguments: { status: "sent" } })) as CallToolResult;
  const list = (listed.structuredContent as { quotes: Array<{ number: string }> }).quotes;
  assert(list.some((q) => q.number === created.number));
  const waiting = (await client.callTool({ name: "quote_status", arguments: { open_older_than_days: 0 } })) as CallToolResult;
  assert((waiting.structuredContent as { quotes: Array<{ number: string }> }).quotes.some((q) => q.number === created.number));
  log("quote_status", `one + list(${list.length}) + open_older_than_days`);

  const resource = await client.readResource({ uri: "ui://billy/quote-card.html" });
  const card = resource.contents[0];
  assert(card && "text" in card, "card resource has text");
  assert.equal(card.mimeType, "text/html;profile=mcp-app");
  assert(card.text.startsWith("<!doctype html>") && !/<script[^>]+src=/.test(card.text) && !/<link[^>]+stylesheet/.test(card.text), "card is self-contained");
  const ui = (card._meta as { ui?: { prefersBorder?: boolean; csp?: unknown } } | undefined)?.ui;
  assert.equal(ui?.prefersBorder, true);
  assert(ui?.csp, "card declares a CSP");
  log("resources/read card", `${card.mimeType}, ${(card.text.length / 1024).toFixed(0)} KiB`);

  await client.close();
  return { token: resend.publicToken, id: created.id };
}

async function publicFlow(token: string): Promise<void> {
  const page = await fetch(`${BASE}/q/${token}`);
  const html = await page.text();
  assert.equal(page.status, 200);
  assert(html.includes("Accept quote") && html.includes("Decline"), "public page offers accept and decline");
  log("GET /q/{token}", "shows Accept and Decline");

  const crossSite = await fetch(`${BASE}/q/${token}/accept`, { method: "POST", redirect: "manual", headers: { Origin: "https://evil.example" } });
  assert.equal(crossSite.status, 403, "cross-site accept is refused");

  const accepted = await fetch(`${BASE}/q/${token}/accept`, { method: "POST", redirect: "manual" });
  assert.equal(accepted.status, 303);
  const after = await (await fetch(`${BASE}/q/${token}`)).text();
  assert(after.includes("Accepted"), "page shows accepted");
  assert(!after.includes("Accept quote"), "accept button gone after accepting");
  const twice = await fetch(`${BASE}/q/${token}/accept`, { method: "POST", redirect: "manual" });
  assert.equal(twice.status, 409, "accepting twice is refused in words");
  log("POST /q/{token}/accept", "303, then 409 on repeat; cross-site 403");

  const pay = await fetch(`${BASE}/pay/${token}`, { redirect: "manual" });
  log(`GET /pay/{token}`, `${pay.status} ${pay.status === 503 ? "(payments not set up: no STRIPE_SECRET_KEY)" : pay.headers.get("location") ?? ""}`);

  const missing = await fetch(`${BASE}/q/not-a-real-token`);
  assert.equal(missing.status, 404);
}

async function webhookFlow(token: string, quoteId: string): Promise<void> {
  if (!WEBHOOK_SECRET) {
    console.log("skip webhook: STRIPE_WEBHOOK_SECRET not set");
    return;
  }
  const event = JSON.stringify({
    id: "evt_smoke_1",
    type: "checkout.session.completed",
    data: { object: { id: "cs_test_smoke", payment_status: "paid", metadata: { quote_id: quoteId } } },
  });
  const sign = (body: string, t = Math.floor(Date.now() / 1000)) =>
    `t=${t},v1=${createHmac("sha256", WEBHOOK_SECRET).update(`${t}.${body}`).digest("hex")}`;
  const post = (body: string, signature: string) =>
    fetch(`${BASE}/stripe/webhook`, { method: "POST", body, headers: { "Stripe-Signature": signature, "Content-Type": "application/json" } });

  assert.equal((await post(event, "t=1,v1=deadbeef")).status, 400, "bad signature rejected");
  assert.equal((await post(event, sign(event, Math.floor(Date.now() / 1000) - 3600))).status, 400, "stale timestamp rejected");
  const first = await (await post(event, sign(event))).json();
  assert.deepEqual(first, { received: true, applied: true });
  const repeat = await (await post(event, sign(event))).json();
  assert.equal(repeat.applied, false, "repeated event is a no-op");
  const page = await (await fetch(`${BASE}/q/${token}`)).text();
  assert(page.includes("Paid"), "public page shows paid");
  log("POST /stripe/webhook", "bad sig 400, stale 400, applied once, repeat no-op, page shows Paid");
}

async function authFlow(): Promise<void> {
  const init = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "x", version: "1" } } };
  for (const auth of [undefined, "Bearer not-a-valid-token"]) {
    const res = await fetch(`${BASE}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...(auth ? { Authorization: auth } : {}) },
      body: JSON.stringify(init),
    });
    assert.equal(res.status, 401);
    const challenge = res.headers.get("WWW-Authenticate") ?? "";
    assert.match(challenge, /^Bearer resource_metadata="http[^"]+\/\.well-known\/oauth-protected-resource\/mcp"/);
    if (auth) assert.match(challenge, /error="invalid_token"/);
  }
  const prm = await (await fetch(`${BASE}/.well-known/oauth-protected-resource/mcp`)).json();
  assert.equal(prm.resource, `${BASE}/mcp`);
  assert.match(prm.authorization_servers[0], /^https:\/\//);
  assert.equal((await fetch(`${BASE}/mcp`, { method: "GET" })).status, 405);
  assert.equal((await fetch(`${BASE}/mcp`, { method: "DELETE" })).status, 405);
  log("auth", "401 + WWW-Authenticate without/with bad token; PRM served; GET/DELETE 405");
}

await authFlow();
const legacy = await runEra("legacy");
await runEra("auto");
await publicFlow(legacy.token);
await webhookFlow(legacy.token, legacy.id);
console.log("smoke passed");
