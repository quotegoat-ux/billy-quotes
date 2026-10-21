import { createQuote, createQuoteInput, toNewQuote, type CreateQuoteInput, type Quote } from "../src/index.ts";

export const NOW = new Date("2026-10-21T15:00:00Z");

export function quoteFrom(input: CreateQuoteInput, now = NOW): Quote {
  return createQuote(toNewQuote(createQuoteInput.parse(input)), {
    id: "q_test",
    ownerId: "user_1",
    seq: 1,
    publicToken: "tok_test",
    now,
  });
}

export const tileJob: CreateQuoteInput = {
  title: "Kitchen backsplash and floor tile",
  customer: { name: "Rosa Delgado", email: "rosa@example.com" },
  items: [
    { description: "Porcelain tile 12x24", quantity: 86.5, unit: "sq ft", unit_price: 4.79 },
    { description: "Thinset mortar, 50 lb bag", quantity: 3, unit_price: 32.98 },
    { description: "Tile installation labor", quantity: 14.5, unit: "HR", unit_price: 65 },
    { description: "Grout, unsanded", quantity: 2, unit_price: 18.47 },
  ],
  discount_percent: 10,
  tax_percent: 8.25,
  deposit_percent: 50,
  valid_days: 14,
};

export const weddingCatering: CreateQuoteInput = {
  title: "Wedding reception catering",
  customer: { name: "Okafor-Lindqvist wedding" },
  items: [
    { description: "Plated dinner, 3 courses", quantity: 120, unit: "guest", unit_price: 48.5 },
    { description: "Bar service", quantity: 4.5, unit: "hr", unit_price: 175 },
    { description: "Cake cutting", quantity: 120, unit: "guest", unit_price: 1.25 },
  ],
  tax_percent: 6.35,
  deposit_percent: 25,
};
