import { assignItemIds, formatQuoteNumber, type ItemContent } from "./ids.ts";
import { addDays, type Customer, type Quote, type QuoteSource } from "./quote.ts";

export const DEFAULT_VALID_DAYS = 30;

export interface NewQuote {
  title: string;
  customer: Customer;
  items: ItemContent[];
  discountPercent: number;
  taxPercent: number;
  depositPercent: number;
  validDays: number;
  notes?: string;
  source?: QuoteSource;
}

export interface NewQuoteIdentity {
  id: string;
  ownerId: string;
  seq: number;
  publicToken: string;
  now: Date;
}

export function createQuote(input: NewQuote, identity: NewQuoteIdentity): Quote {
  const { validDays, items, ...fields } = input;
  return {
    ...fields,
    id: identity.id,
    ownerId: identity.ownerId,
    number: formatQuoteNumber(identity.seq),
    version: 1,
    status: "draft",
    currency: "USD",
    items: assignItemIds(items),
    validUntil: addDays(identity.now, validDays),
    publicToken: identity.publicToken,
    createdAt: identity.now.toISOString(),
  };
}
