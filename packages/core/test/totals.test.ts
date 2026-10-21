import { describe, expect, it } from "vitest";
import { computeTotals, dollarsToCents, formatUSD, lineAmount, toQuoteView, type Cents } from "../src/index.ts";
import { NOW, quoteFrom, tileJob, weddingCatering } from "./fixtures.ts";

const c = (n: number) => n as Cents;

describe("totals", () => {
  it("prices a tile job with units, hourly labor, discount, tax and a 50% deposit", () => {
    const quote = quoteFrom(tileJob);
    // 86.5 x 4.79 = 414.335 rounds half-up to 414.34; 3 x 32.98; 14.5 x 65; 2 x 18.47
    expect(quote.items.map(lineAmount)).toEqual([41434, 9894, 94250, 3694]);
    expect(computeTotals(quote)).toEqual({
      subtotal: 149272,
      discount: 14927, // 10% of 1,492.72 = 149.272
      tax: 11083, // 8.25% of 1,343.45 = 110.834625
      total: 145428,
      amountDue: 72714,
    });
  });

  it("prices per-guest catering with tax and a 25% deposit", () => {
    expect(computeTotals(quoteFrom(weddingCatering))).toEqual({
      subtotal: 675750,
      discount: 0,
      tax: 42910, // 6.35% of 6,757.50 = 429.10125
      total: 718660,
      amountDue: 179665,
    });
  });

  it("charges the full total when there is no deposit", () => {
    const quote = quoteFrom({ ...weddingCatering, deposit_percent: 0 });
    expect(computeTotals(quote).amountDue).toBe(718660);
  });

  it("rounds half a cent up on a line", () => {
    expect(lineAmount({ quantity: 1.5, unitPrice: c(33) })).toBe(50);
    expect(lineAmount({ quantity: 0.125, unitPrice: c(1000) })).toBe(125);
  });

  it("converts dollars to cents without float drift", () => {
    expect(dollarsToCents(1.005)).toBe(101);
    expect(dollarsToCents(0.1 + 0.2)).toBe(30);
    expect(dollarsToCents(19.99)).toBe(1999);
    expect(dollarsToCents(1e-7)).toBe(0);
  });

  it("puts the same totals and line amounts in the tool view", () => {
    const view = toQuoteView(quoteFrom(tileJob), { baseUrl: "https://billy.test/", now: NOW });
    expect(view.totals.total).toBe(145428);
    expect(view.items[0]?.amount).toBe(41434);
    expect(view).not.toHaveProperty("ownerId");
    expect(view.links).toBeUndefined();
    expect(formatUSD(view.totals.total)).toBe("$1,454.28");
  });
});
