import { addCents, cents, mulDivHalfUp, percentToBasisPoints, subCents, toScaledInt, type Cents } from "./money.ts";
import type { LineItem, Quote } from "./quote.ts";

export interface Totals {
  subtotal: Cents;
  discount: Cents;
  tax: Cents;
  total: Cents;
  amountDue: Cents;
}

/**
 * The one place the order of money math lives. Every step works in integer
 * cents and rounds half-up before the next step reads it:
 *
 * 1. line amount = quantity x unit price, per line
 * 2. subtotal    = sum of line amounts
 * 3. discount    = subtotal x discount%
 * 4. tax         = (subtotal - discount) x tax%
 * 5. total       = subtotal - discount + tax
 * 6. amountDue   = total x deposit%, or the full total when deposit% is 0
 */
export function lineAmount(item: Pick<LineItem, "quantity" | "unitPrice">): Cents {
  const milliUnits = toScaledInt(item.quantity, 3);
  return cents(mulDivHalfUp(milliUnits, item.unitPrice, 1000));
}

export function computeTotals(
  quote: Pick<Quote, "items" | "discountPercent" | "taxPercent" | "depositPercent">,
): Totals {
  const subtotal = quote.items.reduce((sum, item) => addCents(sum, lineAmount(item)), cents(0));
  const discount = applyPercent(subtotal, quote.discountPercent);
  const taxable = subCents(subtotal, discount);
  const tax = applyPercent(taxable, quote.taxPercent);
  const total = addCents(taxable, tax);
  const amountDue = quote.depositPercent === 0 ? total : applyPercent(total, quote.depositPercent);
  return { subtotal, discount, tax, total, amountDue };
}

function applyPercent(amount: Cents, percent: number): Cents {
  return cents(mulDivHalfUp(amount, percentToBasisPoints(percent), 10_000));
}
