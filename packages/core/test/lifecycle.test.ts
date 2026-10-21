import { describe, expect, it } from "vitest";
import {
  QUOTE_EVENTS,
  QUOTE_STATUSES,
  computeTotals,
  createQuoteInput,
  describeError,
  formatQuoteNumber,
  parseQuoteNumber,
  reviseQuoteInput,
  revise,
  toQuoteView,
  toReviseOp,
  transition,
  type Quote,
  type QuoteEvent,
  type ReviseOp,
} from "../src/index.ts";
import { NOW, quoteFrom, tileJob } from "./fixtures.ts";

const LATER = new Date("2026-10-22T09:00:00Z");

function must(result: ReturnType<typeof transition>): Quote {
  if (!result.ok) throw new Error(describeError(result.error));
  return result.value;
}

function run(quote: Quote, ...events: QuoteEvent[]): Quote {
  return events.reduce((q, event) => must(transition(q, event, NOW)), quote);
}

function opsFrom(raw: unknown[]): ReviseOp[] {
  return reviseQuoteInput.parse({ quote: "Q-1001", ops: raw }).ops.map(toReviseOp);
}

describe("status transitions", () => {
  it("walks draft to sent to accepted to paid, stamping each step", () => {
    const paid = run(quoteFrom(tileJob), "send", "accept", "pay");
    expect(paid.status).toBe("paid");
    expect(paid.sentAt).toBe(NOW.toISOString());
    expect(paid.acceptedAt).toBe(NOW.toISOString());
    expect(paid.paidAt).toBe(NOW.toISOString());
  });

  it("allows exactly the moves in the spec table and rejects the rest", () => {
    const spec: Record<Quote["status"], QuoteEvent[]> = {
      draft: ["send", "revise"],
      sent: ["revise", "accept", "decline", "pay"],
      accepted: ["pay"],
      paid: [],
      declined: [],
    };
    for (const status of QUOTE_STATUSES) {
      for (const event of QUOTE_EVENTS) {
        const result = transition({ ...quoteFrom(tileJob), status }, event, NOW);
        if (spec[status].includes(event)) {
          expect(result.ok, `${status} + ${event}`).toBe(true);
        } else {
          expect(result, `${status} + ${event}`).toMatchObject({ ok: false, error: { kind: "illegal_transition", from: status, event } });
        }
      }
    }
  });

  it("explains an illegal move in words", () => {
    const result = transition(quoteFrom(tileJob), "accept", NOW);
    expect(!result.ok && describeError(result.error)).toBe(
      "Quote Q-1001 is draft, so it can't be accepted. A draft quote can only be sent or revised.",
    );
  });

  it("refuses to send or accept an expired quote but still records payment on an accepted one", () => {
    const shortLived = quoteFrom({ ...tileJob, valid_days: 1 }, NOW);
    const afterExpiry = new Date("2026-10-23T00:00:01Z");
    expect(transition(shortLived, "send", afterExpiry)).toMatchObject({ ok: false, error: { kind: "expired" } });

    const sent = run(shortLived, "send");
    expect(transition(sent, "accept", afterExpiry)).toMatchObject({ ok: false, error: { kind: "expired" } });

    const accepted = run(sent, "accept");
    expect(transition(accepted, "pay", afterExpiry)).toMatchObject({ ok: true, value: { status: "paid" } });
  });

  it("reports expiry as derived, not stored", () => {
    const quote = quoteFrom({ ...tileJob, valid_days: 1 }, NOW);
    expect(toQuoteView(quote, { baseUrl: "https://b", now: NOW }).expired).toBe(false);
    expect(toQuoteView(quote, { baseUrl: "https://b", now: new Date("2026-10-23T00:00:01Z") }).expired).toBe(true);
  });
});

describe("revise", () => {
  it("returns a sent quote to draft as the next version with the changes applied", () => {
    const sent = run(quoteFrom(tileJob), "send");
    const [mortar] = sent.items.filter((it) => it.description.startsWith("Thinset"));
    const ops = opsFrom([
      { op: "update_item", item_id: mortar!.id, quantity: 4 },
      { op: "add_item", description: "Haul-away and disposal", quantity: 1, unit_price: 120 },
      { op: "set_deposit_percent", percent: 0 },
    ]);
    const revised = must(revise(sent, ops, LATER));
    expect(revised.status).toBe("draft");
    expect(revised.version).toBe(2);
    expect(revised.sentAt).toBeUndefined();
    expect(revised.items).toHaveLength(5);
    // 149,272 + one more bag (3,298) + haul-away (12,000) = 164,570
    expect(computeTotals(revised)).toMatchObject({ subtotal: 164570, amountDue: computeTotals(revised).total });
    expect(must(transition(revised, "send", LATER)).status).toBe("sent");
  });

  it("keeps a draft at the same version", () => {
    const draft = quoteFrom(tileJob);
    const revised = must(revise(draft, opsFrom([{ op: "set_title", title: "Backsplash only" }]), NOW));
    expect(revised).toMatchObject({ status: "draft", version: 1, title: "Backsplash only" });
  });

  it("converges when the same op set is applied twice", () => {
    const sent = run(quoteFrom(tileJob), "send");
    const ops = opsFrom([
      { op: "add_item", description: "Edge trim", quantity: 12, unit: "ft", unit_price: 3.5 },
      { op: "add_item", description: "Edge trim", quantity: 12, unit: "ft", unit_price: 3.5 },
      { op: "remove_item", item_id: sent.items[3]!.id },
      { op: "set_customer", email: "" },
      { op: "set_notes", notes: "Price assumes level subfloor." },
    ]);
    const once = must(revise(sent, ops, LATER));
    const twice = must(revise(once, ops, LATER));
    expect(twice).toEqual(once);
    expect(once.items.filter((it) => it.description === "Edge trim")).toHaveLength(2);
    expect(once.customer).toEqual({ name: "Rosa Delgado" });
  });

  it("fails as a whole when an op names a missing line", () => {
    const draft = quoteFrom(tileJob);
    const result = revise(draft, opsFrom([
      { op: "set_title", title: "Changed" },
      { op: "update_item", item_id: "li_missing", quantity: 2 },
    ]), NOW);
    expect(result).toMatchObject({ ok: false, error: { kind: "item_not_found", itemId: "li_missing" } });
  });

  it("refuses to revise an accepted quote", () => {
    const accepted = run(quoteFrom(tileJob), "send", "accept");
    const result = revise(accepted, opsFrom([{ op: "set_title", title: "x" }]), NOW);
    expect(result).toMatchObject({ ok: false, error: { kind: "illegal_transition", from: "accepted" } });
  });

  it("resets validity from today", () => {
    const draft = quoteFrom(tileJob);
    const revised = must(revise(draft, opsFrom([{ op: "set_valid_days", days: 45 }]), LATER));
    expect(revised.validUntil).toBe("2026-12-06");
  });
});

describe("input schemas", () => {
  it("normalizes units and defaults to each", () => {
    const quote = quoteFrom(tileJob);
    expect(quote.items.map((it) => it.unit)).toEqual(["sq ft", "each", "hr", "each"]);
  });

  it("rejects quantities past 3 decimals and percents past 2", () => {
    const item = { description: "Rope", quantity: 1.2345, unit_price: 1 };
    expect(createQuoteInput.safeParse({ ...tileJob, items: [item] }).success).toBe(false);
    expect(createQuoteInput.safeParse({ ...tileJob, tax_percent: 7.125 }).success).toBe(false);
    expect(createQuoteInput.safeParse({ ...tileJob, tax_percent: 4.35 }).success).toBe(true);
  });

  it("rejects totals and negative prices from clients", () => {
    expect(createQuoteInput.safeParse({ ...tileJob, items: [{ description: "x", quantity: 1, unit_price: -5 }] }).success).toBe(false);
    expect(createQuoteInput.safeParse({ ...tileJob, items: [] }).success).toBe(false);
  });

  it("formats and parses quote numbers", () => {
    expect(formatQuoteNumber(1)).toBe("Q-1001");
    expect(parseQuoteNumber("Q-1042")).toBe(42);
    expect(parseQuoteNumber("q1042")).toBe(42);
    expect(parseQuoteNumber("Q-1000")).toBeUndefined();
    expect(parseQuoteNumber("q_abc")).toBeUndefined();
  });
});
