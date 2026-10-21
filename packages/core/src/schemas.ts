import { z } from "zod";
import { DEFAULT_VALID_DAYS, type NewQuote } from "./create.ts";
import type { ItemContent } from "./ids.ts";
import { dollarsToCents, toScaledInt } from "./money.ts";
import { QUOTE_STATUSES, type Customer, type QuoteSource } from "./quote.ts";
import type { PercentField, ReviseOp } from "./revise.ts";

// k / 10^p is the correctly rounded double for a decimal with at most p places, so it round-trips exactly.
const hasAtMostDecimals = (places: number) => (n: number) => toScaledInt(n, places) / 10 ** places === n;

const quantity = z
  .number()
  .positive()
  .max(1_000_000)
  .refine(hasAtMostDecimals(3), "quantity can have at most 3 decimals")
  .describe("How many units, e.g. 2, 1.5 (hours), 0.25 (kg). Up to 3 decimals.");

const unit = z
  .string()
  .trim()
  .min(1)
  .max(20)
  .describe('Unit the quantity counts, lowercase: "each", "hr", "kg", "guest", "sq ft". Defaults to "each".');

const unitPrice = z
  .number()
  .nonnegative()
  .max(10_000_000)
  .describe("Price per unit in US dollars, e.g. 85 or 12.5. Never send totals; the server computes them.");

const percent = (what: string) =>
  z
    .number()
    .min(0)
    .max(100)
    .refine(hasAtMostDecimals(2), "percent can have at most 2 decimals")
    .describe(what);

const description = z.string().trim().min(1).max(500);

export const lineItemInput = z.object({
  description: description.describe("What the line is for, as the customer should read it."),
  quantity,
  unit: unit.optional(),
  unit_price: unitPrice,
});

const customerInput = z.object({
  name: z.string().trim().min(1).max(200).describe("Customer or company name."),
  email: z.email().optional().describe("Customer email, if known."),
});

export const quoteRef = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .describe('The quote id, or its number such as "Q-1001".');

const validDays = z.int().min(1).max(365);

export const createQuoteInput = z.object({
  title: z.string().trim().min(1).max(200).describe('Short title, e.g. "Kitchen backsplash install".'),
  customer: customerInput,
  items: z.array(lineItemInput).min(1).max(200),
  discount_percent: percent("Discount on the subtotal, 0 to 100. Default 0.").optional(),
  tax_percent: percent("Sales tax on the discounted subtotal, 0 to 100. Default 0.").optional(),
  deposit_percent: percent("Share of the total due up front, 0 to 100. 0 means pay in full. Default 0.").optional(),
  notes: z.string().trim().max(4000).optional().describe("Terms or notes shown to the customer."),
  valid_days: validDays.optional().describe(`Days the quote stays valid. Default ${DEFAULT_VALID_DAYS}.`),
  source_name: z.string().trim().min(1).max(200).optional().describe("Name of the file the quote was drafted from."),
  source_file: z
    .object({
      download_url: z.url().optional(),
      file_id: z.string().optional(),
      name: z.string().optional(),
    })
    .optional()
    .describe("An uploaded file (price list, takeoff, brief) the quote was drafted from."),
});

const percentFields = {
  set_discount_percent: "discountPercent",
  set_tax_percent: "taxPercent",
  set_deposit_percent: "depositPercent",
} as const satisfies Record<string, PercentField>;

const itemId = z.string().trim().min(1).max(40).describe("A line item id from the quote.");

export const reviseOpInput = z.discriminatedUnion("op", [
  lineItemInput.extend({
    op: z.literal("add_item"),
    item_id: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,40}$/)
      .optional()
      .describe("Optional id for the new line. Re-adding a line with the same content replaces it rather than duplicating it; to add more of an existing line, update its quantity."),
  }),
  z.object({
    op: z.literal("update_item"),
    item_id: itemId,
    description: description.optional(),
    quantity: quantity.optional(),
    unit: unit.optional(),
    unit_price: unitPrice.optional(),
  }),
  z.object({ op: z.literal("remove_item"), item_id: itemId }),
  z.object({
    op: z.literal("set_customer"),
    name: z.string().trim().min(1).max(200).optional(),
    email: z.union([z.email(), z.literal("")]).optional().describe('New email, or "" to clear it.'),
  }),
  z.object({ op: z.literal("set_title"), title: z.string().trim().min(1).max(200) }),
  z.object({ op: z.literal("set_notes"), notes: z.string().trim().max(4000).describe('New notes, or "" to clear them.') }),
  z.object({ op: z.literal("set_discount_percent"), percent: percent("0 to 100") }),
  z.object({ op: z.literal("set_tax_percent"), percent: percent("0 to 100") }),
  z.object({ op: z.literal("set_deposit_percent"), percent: percent("0 to 100; 0 means pay in full") }),
  z.object({ op: z.literal("set_valid_days"), days: validDays.describe("Valid for this many days from today.") }),
]);

export const reviseQuoteInput = z.object({
  quote: quoteRef,
  ops: z.array(reviseOpInput).min(1).max(100).describe("Changes to apply in order."),
});

export const quoteStatusInput = z.object({
  quote: quoteRef.optional().describe("One quote to show. Leave out to list quotes."),
  status: z.enum(QUOTE_STATUSES).optional().describe("List only quotes in this status."),
  open_older_than_days: z
    .int()
    .min(0)
    .max(3650)
    .optional()
    .describe("List sent or accepted quotes that have waited at least this many days since sending. Use for follow-ups."),
  limit: z.int().min(1).max(50).optional().describe("Most quotes to list. Default 20."),
});

export const sendQuoteInput = z.object({ quote: quoteRef });

export const priceLookupInput = z.object({
  query: z.string().trim().min(1).max(100).describe('Words from the line description, e.g. "drywall" or "catering".'),
  limit: z.int().min(1).max(20).optional().describe("Most matches to return. Default 10."),
});

export type CreateQuoteInput = z.infer<typeof createQuoteInput>;
export type ReviseOpInput = z.infer<typeof reviseOpInput>;
export type ReviseQuoteInput = z.infer<typeof reviseQuoteInput>;
export type QuoteStatusInput = z.infer<typeof quoteStatusInput>;
export type SendQuoteInput = z.infer<typeof sendQuoteInput>;
export type PriceLookupInput = z.infer<typeof priceLookupInput>;

export const DEFAULT_UNIT = "each";

export function normalizeUnit(text: string | undefined): string {
  const trimmed = text?.trim().toLowerCase();
  return trimmed ? trimmed : DEFAULT_UNIT;
}

export function toItemContent(input: z.infer<typeof lineItemInput>): ItemContent {
  return {
    description: input.description,
    quantity: input.quantity,
    unit: normalizeUnit(input.unit),
    unitPrice: dollarsToCents(input.unit_price),
  };
}

export function toNewQuote(input: CreateQuoteInput): NewQuote {
  const customer: Customer = { name: input.customer.name };
  if (input.customer.email) customer.email = input.customer.email;
  const quote: NewQuote = {
    title: input.title,
    customer,
    items: input.items.map(toItemContent),
    discountPercent: input.discount_percent ?? 0,
    taxPercent: input.tax_percent ?? 0,
    depositPercent: input.deposit_percent ?? 0,
    validDays: input.valid_days ?? DEFAULT_VALID_DAYS,
  };
  if (input.notes) quote.notes = input.notes;
  const source = toSource(input);
  if (source) quote.source = source;
  return quote;
}

function toSource(input: CreateQuoteInput): QuoteSource | undefined {
  const file = input.source_file;
  const name = input.source_name ?? file?.name ?? file?.file_id;
  if (!name) return undefined;
  return file?.download_url ? { name, url: file.download_url } : { name };
}

export function toReviseOp(input: ReviseOpInput): ReviseOp {
  switch (input.op) {
    case "add_item": {
      const op: ReviseOp = { op: "add_item", item: toItemContent(input) };
      return input.item_id ? { ...op, itemId: input.item_id } : op;
    }
    case "update_item": {
      const changes: Partial<ItemContent> = {};
      if (input.description !== undefined) changes.description = input.description;
      if (input.quantity !== undefined) changes.quantity = input.quantity;
      if (input.unit !== undefined) changes.unit = normalizeUnit(input.unit);
      if (input.unit_price !== undefined) changes.unitPrice = dollarsToCents(input.unit_price);
      return { op: "update_item", itemId: input.item_id, changes };
    }
    case "remove_item":
      return { op: "remove_item", itemId: input.item_id };
    case "set_customer": {
      const op: Extract<ReviseOp, { op: "set_customer" }> = { op: "set_customer" };
      if (input.name !== undefined) op.name = input.name;
      if (input.email !== undefined) op.email = input.email === "" ? null : input.email;
      return op;
    }
    case "set_title":
      return { op: "set_title", title: input.title };
    case "set_notes":
      return { op: "set_notes", notes: input.notes === "" ? null : input.notes };
    case "set_discount_percent":
    case "set_tax_percent":
    case "set_deposit_percent":
      return { op: "set_percent", field: percentFields[input.op], percent: input.percent };
    case "set_valid_days":
      return { op: "set_valid_days", days: input.days };
    default: {
      const exhaustive: never = input;
      return exhaustive;
    }
  }
}
