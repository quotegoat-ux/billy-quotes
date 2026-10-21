import { createQuote, createQuoteInput, revise, reviseQuoteInput, toNewQuote, toQuoteView, toReviseOp, type QuoteView } from "@billy/core";
import { describe, expect, it } from "vitest";
import { blankRow, draftFromView, opsFromDraft, previewTotals } from "../src/edit-ops.ts";

const NOW = new Date("2026-10-21T15:00:00Z");

function sampleView(): QuoteView {
  const input = createQuoteInput.parse({
    title: "Office move",
    customer: { name: "Northwind Dental" },
    items: [
      { description: "Movers (crew of 3)", quantity: 6, unit: "hr", unit_price: 165 },
      { description: "Moving boxes", quantity: 40, unit_price: 2.75 },
      { description: "Truck and fuel", quantity: 1, unit_price: 240 },
    ],
    tax_percent: 8,
  });
  const quote = createQuote(toNewQuote(input), { id: "q1", ownerId: "u1", seq: 7, publicToken: "t", now: NOW });
  return toQuoteView(quote, { baseUrl: "https://b", now: NOW });
}

describe("editor ops", () => {
  it("emits nothing when nothing changed", () => {
    const view = sampleView();
    expect(opsFromDraft(view, draftFromView(view))).toEqual({ ok: true, ops: [] });
  });

  it("emits only the changes, and the server applies them to the edited state", () => {
    const view = sampleView();
    const draft = draftFromView(view);
    draft.rows[0]!.quantity = "7.5";
    draft.rows.splice(1, 1);
    draft.rows.push({ ...blankRow(), description: "Piano dolly", unitPrice: "$35.00" });
    draft.customerEmail = "office@northwind.example";
    draft.depositPercent = "30";

    const result = opsFromDraft(view, draft);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ops).toHaveLength(5);

    const parsed = reviseQuoteInput.parse({ quote: view.id, ops: result.ops }).ops.map(toReviseOp);
    const quote = { ...view, ownerId: "u1", items: view.items.map(({ amount: _a, ...it }) => it) };
    const applied = revise(quote, parsed, NOW);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.value.items.map((it) => [it.description, it.quantity, it.unitPrice])).toEqual([
      ["Movers (crew of 3)", 7.5, 16500],
      ["Truck and fuel", 1, 24000],
      ["Piano dolly", 1, 3500],
    ]);
    expect(applied.value.customer.email).toBe("office@northwind.example");
    expect(applied.value.depositPercent).toBe(30);
  });

  it("reports unparseable and invalid lines instead of sending them", () => {
    const view = sampleView();
    const draft = draftFromView(view);
    draft.rows[0]!.quantity = "six";
    draft.rows[1]!.unitPrice = "-2";
    const result = opsFromDraft(view, draft);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0]).toMatch(/^Line 1: enter a number for quantity/);
    expect(result.errors[1]).toMatch(/^Line 2:/);
  });

  it("previews totals from the form before saving", () => {
    const view = sampleView();
    const draft = draftFromView(view);
    // 6 x 165 + 40 x 2.75 + 240 = 1,340.00; 8% tax = 107.20
    expect(previewTotals(view, draft)).toMatchObject({ subtotal: 134000, tax: 10720, total: 144720 });
    draft.rows[2]!.unitPrice = "";
    expect(previewTotals(view, draft).subtotal).toBe(110000);
  });
});
