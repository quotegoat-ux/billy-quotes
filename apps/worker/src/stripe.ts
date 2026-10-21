import { computeTotals, isPayable, transition, type Quote } from "@billy/core";
import { z } from "zod";
import { baseUrl } from "./auth.ts";
import type { Env } from "./env.ts";
import { notFound, page, sameOrigin, showQuote } from "./public.ts";
import type { QuoteStore } from "./store.ts";

const SIGNATURE_TOLERANCE_SECONDS = 300;

export async function handlePay(request: Request, token: string, env: Env, store: QuoteStore, now: Date): Promise<Response> {
  if (!sameOrigin(request, env)) return new Response("Forbidden", { status: 403 });
  const stored = await store.getByToken(token);
  if (!stored || stored.quote.status === "draft") return notFound();
  if (!env.STRIPE_SECRET_KEY) {
    return page("Payments not set up", `<h1>Payments not set up</h1><p class="muted">Online payment isn't turned on for this quote yet. Please contact the sender to arrange payment.</p>`, 503);
  }
  if (!isPayable(stored.quote, now)) {
    const reason = stored.quote.status === "paid" ? "This quote is already paid." : "This quote can't be paid right now.";
    return showQuote(token, env, store, now, reason);
  }
  const session = await createCheckoutSession(env, stored.quote);
  if (!session.ok) {
    return page("Payment unavailable", `<h1>Payment unavailable</h1><p class="muted">We couldn't start the payment. Please try again in a minute.</p>`, 502);
  }
  return Response.redirect(session.url, 303);
}

export async function createCheckoutSession(env: Env, quote: Quote): Promise<{ ok: true; url: string } | { ok: false }> {
  const totals = computeTotals(quote);
  const base = baseUrl(env);
  const quoteUrl = `${base}/q/${encodeURIComponent(quote.publicToken)}`;
  const form = new URLSearchParams({
    mode: "payment",
    success_url: `${quoteUrl}?paid=1`,
    cancel_url: quoteUrl,
    client_reference_id: quote.id,
    "metadata[quote_id]": quote.id,
    "metadata[quote_version]": String(quote.version),
    "payment_intent_data[metadata][quote_id]": quote.id,
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][unit_amount]": String(totals.amountDue),
    "line_items[0][price_data][product_data][name]": `${quote.number} ${quote.title}${quote.depositPercent ? ` (${quote.depositPercent}% deposit)` : ""}`.slice(0, 250),
  });
  if (quote.customer.email) form.set("customer_email", quote.customer.email);
  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
  });
  if (!response.ok) return { ok: false };
  const body = z.object({ url: z.url() }).safeParse(await response.json());
  return body.success ? { ok: true, url: body.data.url } : { ok: false };
}

const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");

/** Stripe signs `${t}.${body}` with HMAC-SHA256; the header carries t and one or more v1 signatures. */
export async function verifyStripeSignature(body: string, header: string | null, secret: string, now: Date): Promise<boolean> {
  if (!header) return false;
  const parts = header.split(",").map((part) => {
    const at = part.indexOf("=");
    return { key: part.slice(0, at).trim(), value: part.slice(at + 1).trim() };
  });
  const timestamp = parts.find((p) => p.key === "t")?.value;
  const signatures = parts.filter((p) => p.key === "v1" && p.value).map((p) => p.value);
  if (!timestamp || !/^\d+$/.test(timestamp) || signatures.length === 0) return false;
  if (Math.abs(now.getTime() / 1000 - Number(timestamp)) > SIGNATURE_TOLERANCE_SECONDS) return false;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = encoder.encode(hex(await crypto.subtle.sign("HMAC", key, encoder.encode(`${timestamp}.${body}`))));
  return signatures.some((sig) => {
    const given = encoder.encode(sig);
    return given.byteLength === expected.byteLength && crypto.subtle.timingSafeEqual(given, expected);
  });
}

const checkoutEvent = z.object({
  id: z.string(),
  type: z.string(),
  data: z.object({
    object: z.object({
      payment_status: z.string().optional(),
      metadata: z.record(z.string(), z.string()).nullable().optional(),
    }),
  }),
});

const PAID_EVENTS = new Set(["checkout.session.completed", "checkout.session.async_payment_succeeded"]);
const MAX_ATTEMPTS = 3;

/**
 * Applies `pay` for a completed Checkout Session. Stripe retries deliveries,
 * so a repeat for an already-paid quote is acknowledged and changes nothing.
 */
export async function handleWebhook(request: Request, env: Env, store: QuoteStore, now: Date): Promise<Response> {
  if (!env.STRIPE_WEBHOOK_SECRET) return new Response("Webhook not configured", { status: 503 });
  const body = await request.text();
  if (!(await verifyStripeSignature(body, request.headers.get("Stripe-Signature"), env.STRIPE_WEBHOOK_SECRET, now))) {
    return new Response("Bad signature", { status: 400 });
  }
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }
  const parsed = checkoutEvent.safeParse(json);
  if (!parsed.success || !PAID_EVENTS.has(parsed.data.type)) return Response.json({ received: true, applied: false });
  const session = parsed.data.data.object;
  const quoteId = session.metadata?.quote_id;
  if (session.payment_status !== "paid" || !quoteId) return Response.json({ received: true, applied: false });

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const stored = await store.getById(quoteId);
    if (!stored) return Response.json({ received: true, applied: false, reason: "unknown quote" });
    if (stored.quote.status === "paid") return Response.json({ received: true, applied: false, reason: "already paid" });
    const next = transition(stored.quote, "pay", now);
    if (!next.ok) return Response.json({ received: true, applied: false, reason: next.error.kind });
    if (await store.update(stored, next.value)) return Response.json({ received: true, applied: true });
  }
  return new Response("Conflict, retry", { status: 500 });
}
