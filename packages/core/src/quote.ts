import type { Cents } from "./money.ts";

export const QUOTE_STATUSES = ["draft", "sent", "accepted", "paid", "declined"] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

export const QUOTE_EVENTS = ["send", "revise", "accept", "decline", "pay"] as const;
export type QuoteEvent = (typeof QUOTE_EVENTS)[number];

export interface LineItem {
  id: string;
  description: string;
  quantity: number;
  unit: string;
  unitPrice: Cents;
}

export interface Customer {
  name: string;
  email?: string;
}

export interface QuoteSource {
  name: string;
  url?: string;
}

export interface Quote {
  id: string;
  ownerId: string;
  number: string;
  version: number;
  status: QuoteStatus;
  title: string;
  customer: Customer;
  currency: "USD";
  items: LineItem[];
  discountPercent: number;
  taxPercent: number;
  depositPercent: number;
  notes?: string;
  validUntil: string;
  publicToken: string;
  source?: QuoteSource;
  createdAt: string;
  sentAt?: string;
  acceptedAt?: string;
  paidAt?: string;
}

export type QuoteError =
  | { kind: "illegal_transition"; from: QuoteStatus; event: QuoteEvent; number: string }
  | { kind: "expired"; validUntil: string; number: string }
  | { kind: "item_not_found"; itemId: string; number: string };

export type Result<T, E = QuoteError> = { ok: true; value: T } | { ok: false; error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

export const TRANSITIONS = {
  draft: { send: "sent", revise: "draft" },
  sent: { revise: "draft", accept: "accepted", decline: "declined", pay: "paid" },
  accepted: { pay: "paid" },
  paid: {},
  declined: {},
} as const satisfies Record<QuoteStatus, Partial<Record<QuoteEvent, QuoteStatus>>>;

/** Events that are refused once validUntil has passed. Paying an accepted quote is not, because the customer agreed in time. */
const BLOCKED_WHEN_EXPIRED: ReadonlySet<QuoteEvent> = new Set(["send", "accept"]);

export function nextStatus(from: QuoteStatus, event: QuoteEvent): QuoteStatus | undefined {
  const row: Partial<Record<QuoteEvent, QuoteStatus>> = TRANSITIONS[from];
  return row[event];
}

export function allowedEvents(status: QuoteStatus): QuoteEvent[] {
  return QUOTE_EVENTS.filter((event) => nextStatus(status, event) !== undefined);
}

export function isoDate(at: Date): string {
  return at.toISOString().slice(0, 10);
}

export function addDays(at: Date, days: number): string {
  return isoDate(new Date(at.getTime() + days * 86_400_000));
}

/** A quote is valid through the whole of its validUntil day (UTC). */
export function isExpired(quote: Pick<Quote, "validUntil">, now: Date): boolean {
  return isoDate(now) > quote.validUntil;
}

/** Whether the customer can pay right now: an accepted quote, or a sent quote still in date. */
export function isPayable(quote: Pick<Quote, "status" | "validUntil">, now: Date): boolean {
  if (quote.status === "accepted") return true;
  return quote.status === "sent" && !isExpired(quote, now);
}

export function transition(quote: Quote, event: QuoteEvent, now: Date): Result<Quote> {
  const to = nextStatus(quote.status, event);
  if (!to) return err({ kind: "illegal_transition", from: quote.status, event, number: quote.number });
  if (BLOCKED_WHEN_EXPIRED.has(event) && isExpired(quote, now)) {
    return err({ kind: "expired", validUntil: quote.validUntil, number: quote.number });
  }
  const at = now.toISOString();
  switch (event) {
    case "send":
      return ok({ ...quote, status: to, sentAt: at });
    case "revise": {
      if (quote.status === "draft") return ok(quote);
      const { sentAt: _sentAt, ...rest } = quote;
      return ok({ ...rest, status: to, version: quote.version + 1 });
    }
    case "accept":
      return ok({ ...quote, status: to, acceptedAt: at });
    case "decline":
      return ok({ ...quote, status: to });
    case "pay":
      return ok({ ...quote, status: to, paidAt: at });
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}

const EVENT_VERBS: Record<QuoteEvent, string> = {
  send: "sent",
  revise: "revised",
  accept: "accepted",
  decline: "declined",
  pay: "paid",
};

export function describeError(error: QuoteError): string {
  switch (error.kind) {
    case "illegal_transition": {
      const allowed = allowedEvents(error.from).map((e) => EVENT_VERBS[e]);
      const options = allowed.length ? ` A ${error.from} quote can only be ${allowed.join(" or ")}.` : "";
      return `Quote ${error.number} is ${error.from}, so it can't be ${EVENT_VERBS[error.event]}.${options}`;
    }
    case "expired":
      return `Quote ${error.number} expired after ${error.validUntil}. Revise it with new valid days first.`;
    case "item_not_found":
      return `Quote ${error.number} has no line item with id ${error.itemId}.`;
    default: {
      const exhaustive: never = error;
      return exhaustive;
    }
  }
}
