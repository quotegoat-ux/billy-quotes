import {
  createQuote,
  createQuoteInput,
  describeError,
  describeList,
  describeQuote,
  priceLookupInput,
  quoteStatusInput,
  revise,
  reviseQuoteInput,
  sendQuoteInput,
  toListEntry,
  toNewQuote,
  toQuoteView,
  toReviseOp,
  transition,
  type Quote,
  type QuoteView,
  type Result,
  type QuoteError,
} from "@billy/core";
import { QUOTE_CARD_HTML } from "@billy/quote-card";
import { RESOURCE_MIME_TYPE, registerAppResource, registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { McpServer, type CallToolResult } from "@modelcontextprotocol/server";
import { baseUrl } from "./auth.ts";
import type { Env } from "./env.ts";
import type { QuoteStore, Stored } from "./store.ts";

export const CARD_URI = "ui://billy/quote-card.html";

export interface ToolDeps {
  store: QuoteStore;
  ownerId: string;
  env: Env;
  now: () => Date;
}

const text = (body: string): CallToolResult["content"] => [{ type: "text", text: body }];
const failure = (body: string): CallToolResult => ({ isError: true, content: text(body) });

function cardMeta(invoking: string, invoked: string, extra: Record<string, unknown> = {}) {
  return {
    ui: { resourceUri: CARD_URI },
    "openai/outputTemplate": CARD_URI,
    "openai/widgetAccessible": true,
    "openai/toolInvocation/invoking": invoking,
    "openai/toolInvocation/invoked": invoked,
    ...extra,
  };
}

function randomId(prefix: string, bytes: number): string {
  const raw = crypto.getRandomValues(new Uint8Array(bytes));
  const b64 = btoa(String.fromCharCode(...raw)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${prefix}${b64}`;
}

const MAX_WRITE_ATTEMPTS = 3;

/**
 * Read, change, compare-and-set; on a lost race, re-read and re-apply. The
 * change functions are pure, so a retry recomputes from the newer row.
 */
async function writeQuote(
  deps: ToolDeps,
  ref: string,
  change: (quote: Quote) => Result<Quote, QuoteError> | { unchanged: Quote },
): Promise<Result<{ quote: Quote; changed: boolean }, string>> {
  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt++) {
    const stored: Stored | null = await deps.store.get(deps.ownerId, ref);
    if (!stored) return { ok: false, error: `No quote matches "${ref}". Use quote_status to list quotes.` };
    const outcome = change(stored.quote);
    if ("unchanged" in outcome) return { ok: true, value: { quote: outcome.unchanged, changed: false } };
    if (!outcome.ok) return { ok: false, error: describeError(outcome.error) };
    if (await deps.store.update(stored, outcome.value)) return { ok: true, value: { quote: outcome.value, changed: true } };
  }
  return { ok: false, error: "The quote changed while saving. Try again." };
}

export function createMcpServer(deps: ToolDeps): McpServer {
  const { store, ownerId, env, now } = deps;
  const server = new McpServer({ name: "billy-quotes", version: "1.0.0" });
  const view = (quote: Quote): QuoteView => toQuoteView(quote, { baseUrl: baseUrl(env), now: now() });
  const quoteResult = (quote: Quote, lead = ""): CallToolResult => {
    const v = view(quote);
    return { content: text(lead + describeQuote(v)), structuredContent: { quote: v } };
  };

  registerAppTool(
    server,
    "create_quote",
    {
      title: "Create quote",
      description:
        "Create a draft quote for any business, goods or services. Give each line a description, quantity, unit and unit price in dollars; the server computes all totals. Optional discount, tax and deposit percents. Attach the source file (price list, takeoff, brief) if the quote came from one.",
      inputSchema: createQuoteInput,
      annotations: { title: "Create quote", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      _meta: cardMeta("Drafting quote…", "Quote drafted", { "openai/fileParams": ["source_file"] }),
    },
    async (input) => {
      const at = now();
      const quote = await store.create(ownerId, (seq) =>
        createQuote(toNewQuote(input), { id: randomId("q_", 12), ownerId, seq, publicToken: randomId("", 24), now: at }),
      );
      return quoteResult(quote, "Created a draft. Review it, then send_quote when it's right.\n");
    },
  );

  registerAppTool(
    server,
    "revise_quote",
    {
      title: "Revise quote",
      description:
        "Change a draft or sent quote with a list of ops: add_item, update_item, remove_item (by item id from the quote), set_customer, set_title, set_notes, set_discount_percent, set_tax_percent, set_deposit_percent, set_valid_days. Revising a sent quote returns it to draft as the next version; send it again after. Re-sending the same ops is safe.",
      inputSchema: reviseQuoteInput,
      annotations: { title: "Revise quote", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      _meta: cardMeta("Revising quote…", "Quote revised"),
    },
    async (input) => {
      const ops = input.ops.map(toReviseOp);
      const at = now();
      const result = await writeQuote(deps, input.quote, (quote) => revise(quote, ops, at));
      return result.ok ? quoteResult(result.value.quote, "Revised.\n") : failure(result.error);
    },
  );

  registerAppTool(
    server,
    "quote_status",
    {
      title: "Quote status",
      description:
        "Show one quote by id or number, or list quotes filtered by status. Use open_older_than_days to find sent or accepted quotes waiting on the customer, for follow-ups.",
      inputSchema: quoteStatusInput,
      annotations: { title: "Quote status", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      _meta: cardMeta("Looking up quotes…", "Quotes found"),
    },
    async (input) => {
      if (input.quote) {
        const stored = await store.get(ownerId, input.quote);
        return stored ? quoteResult(stored.quote) : failure(`No quote matches "${input.quote}".`);
      }
      const at = now();
      const quotes = await store.list(ownerId, {
        ...(input.status ? { status: input.status } : {}),
        ...(input.open_older_than_days !== undefined ? { openOlderThanDays: input.open_older_than_days } : {}),
        limit: input.limit ?? 20,
        now: at,
      });
      const entries = quotes.map((q) => toListEntry(q, at));
      return { content: text(describeList(entries)), structuredContent: { quotes: entries } };
    },
  );

  registerAppTool(
    server,
    "send_quote",
    {
      title: "Send quote",
      description:
        "Mark a draft quote as sent and get its customer link and pay link to share. This does not email anyone; give the links to the user. Calling it on an already sent quote returns the same links.",
      inputSchema: sendQuoteInput,
      annotations: { title: "Send quote", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      _meta: cardMeta("Sending quote…", "Quote ready to share"),
    },
    async (input) => {
      const at = now();
      const result = await writeQuote(deps, input.quote, (quote) =>
        quote.status === "draft" ? transition(quote, "send", at) : { unchanged: quote },
      );
      if (!result.ok) return failure(result.error);
      const { quote, changed } = result.value;
      const lead = changed
        ? "Sent. Share these links with the customer; nothing was emailed.\n"
        : `Already ${quote.status}; here are its links.\n`;
      return quoteResult(quote, lead);
    },
  );

  server.registerTool(
    "price_lookup",
    {
      title: "Price lookup",
      description:
        "Search line items this user quoted before. Returns the last, lowest and highest unit price in dollars and how often each was quoted, per description and unit. Use it to price new quotes consistently.",
      inputSchema: priceLookupInput,
      annotations: { title: "Price lookup", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (input) => {
      const stats = await store.priceLookup(ownerId, input.query, input.limit ?? 10);
      const matches = stats.map((s) => ({
        description: s.description,
        unit: s.unit,
        last: s.last / 100,
        min: s.min / 100,
        max: s.max / 100,
        count: s.count,
        lastQuotedAt: s.lastQuotedAt,
      }));
      const summary = matches.length
        ? matches.map((m) => `${m.description} (per ${m.unit}): last $${m.last.toFixed(2)}, range $${m.min.toFixed(2)}-$${m.max.toFixed(2)}, quoted ${m.count}x`).join("\n")
        : `No past line items match "${input.query}".`;
      return { content: text(summary), structuredContent: { matches } };
    },
  );

  const uiMeta = {
    csp: { connectDomains: [], resourceDomains: [] },
    prefersBorder: true,
    permissions: { clipboardWrite: {} },
    ...(env.MCP_UI_DOMAIN ? { domain: env.MCP_UI_DOMAIN } : {}),
  };
  const openaiMeta = {
    "openai/widgetDescription": "A quote card with line items, totals and actions to send, share, or edit the quote.",
    "openai/widgetPrefersBorder": true,
    "openai/widgetCSP": { connect_domains: [], resource_domains: [] },
    ...(env.OPENAI_WIDGET_DOMAIN ? { "openai/widgetDomain": env.OPENAI_WIDGET_DOMAIN } : {}),
  };
  registerAppResource(
    server,
    "Quote card",
    CARD_URI,
    { description: "Interactive quote card", mimeType: RESOURCE_MIME_TYPE, _meta: { ui: uiMeta } },
    async () => ({
      contents: [{ uri: CARD_URI, mimeType: RESOURCE_MIME_TYPE, text: QUOTE_CARD_HTML, _meta: { ui: uiMeta, ...openaiMeta } }],
    }),
  );

  return server;
}
