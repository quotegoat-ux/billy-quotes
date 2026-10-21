import { createQuote, createQuoteInput, toNewQuote, toQuoteView, transition, type Quote } from "@billy/core";
import { describe, expect, it } from "vitest";
import { renderQuotePage } from "../src/public.ts";

const created = new Date("2026-10-01T12:00:00Z");

function sent(): Quote {
  const input = createQuoteInput.parse({
    title: "Logo and brand guide",
    customer: { name: "Tidewater Coffee" },
    items: [{ description: "Brand discovery workshop", quantity: 6, unit: "hr", unit_price: 150 }],
    valid_days: 7,
  });
  const result = transition(createQuote(toNewQuote(input), { id: "q1", ownerId: "u", seq: 1, publicToken: "tok", now: created }), "send", created);
  if (!result.ok) throw new Error("send failed");
  return result.value;
}

async function html(quote: Quote, now: Date, paymentsEnabled = true): Promise<string> {
  return renderQuotePage(toQuoteView(quote, { baseUrl: "https://q.example", now }), { now, paymentsEnabled }).text();
}

describe("public quote page", () => {
  it("offers accept, pay and decline while the quote is open", async () => {
    const page = await html(sent(), new Date("2026-10-03T00:00:00Z"));
    expect(page).toContain('action="/q/tok/accept"');
    expect(page).toContain('action="/pay/tok"');
    expect(page).toContain('action="/q/tok/decline"');
  });

  it("shows the expired state and no buttons once validUntil has passed", async () => {
    const page = await html(sent(), new Date("2026-10-09T00:00:01Z"));
    expect(page).toContain("This quote expired on 2026-10-08");
    expect(page).not.toContain("<form");
  });

  it("hides Pay when payments are not set up", async () => {
    const page = await html(sent(), new Date("2026-10-03T00:00:00Z"), false);
    expect(page).not.toContain('action="/pay/tok"');
  });

  it("escapes customer-supplied text", async () => {
    const quote = { ...sent(), title: '<img src=x onerror="alert(1)">' };
    const page = await html(quote, new Date("2026-10-03T00:00:00Z"));
    expect(page).not.toContain("<img src=x");
    expect(page).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  });
});
