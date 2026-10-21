import { createQuote, createQuoteInput, toNewQuote, transition } from "@billy/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env.ts";
import { createCheckoutSession } from "../src/stripe.ts";

const env = { PUBLIC_BASE_URL: "https://quotes.example.com/", STRIPE_SECRET_KEY: "sk_test_123" } as Env;
const now = new Date("2026-10-21T15:00:00Z");

function sentQuote() {
  const input = createQuoteInput.parse({
    title: "Deck rebuild",
    customer: { name: "Sam Park", email: "sam@example.com" },
    items: [
      { description: "Pressure-treated lumber", quantity: 64, unit: "board", unit_price: 18.75 },
      { description: "Carpentry", quantity: 22, unit: "hr", unit_price: 72 },
    ],
    tax_percent: 7,
    deposit_percent: 40,
  });
  const draft = createQuote(toNewQuote(input), { id: "q_abc", ownerId: "u", seq: 3, publicToken: "tok_xyz", now });
  const sent = transition(draft, "send", now);
  if (!sent.ok) throw new Error("send failed");
  return sent.value;
}

afterEach(() => vi.unstubAllGlobals());

describe("Stripe Checkout", () => {
  it("asks Stripe for the deposit amount in cents with the quote id in metadata", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return Response.json({ id: "cs_test_1", url: "https://checkout.stripe.com/c/pay/cs_test_1" });
    });

    const result = await createCheckoutSession(env, sentQuote());

    expect(result).toEqual({ ok: true, url: "https://checkout.stripe.com/c/pay/cs_test_1" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.stripe.com/v1/checkout/sessions");
    expect(new Headers(calls[0]!.init.headers).get("Authorization")).toBe("Bearer sk_test_123");
    const form = Object.fromEntries(new URLSearchParams(String(calls[0]!.init.body)));
    // 64 x 18.75 + 22 x 72 = 2,784.00; 7% tax = 194.88; total 2,978.88; 40% deposit = 1,191.552 -> 1,191.55
    expect(form).toMatchObject({
      mode: "payment",
      "line_items[0][price_data][currency]": "usd",
      "line_items[0][price_data][unit_amount]": "119155",
      "line_items[0][quantity]": "1",
      "metadata[quote_id]": "q_abc",
      customer_email: "sam@example.com",
      success_url: "https://quotes.example.com/q/tok_xyz?paid=1",
      cancel_url: "https://quotes.example.com/q/tok_xyz",
    });
  });

  it("reports failure when Stripe refuses", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ error: { message: "Invalid API Key" } }, { status: 401 }));
    expect(await createCheckoutSession(env, sentQuote())).toEqual({ ok: false });
  });
});
