import { QUOTE_STATUSES, type QuoteListEntry, type QuoteStatus, type QuoteView } from "@billy/core";

export type Payload = { kind: "quote"; quote: QuoteView } | { kind: "list"; quotes: QuoteListEntry[] };

export const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const isStatus = (v: unknown): v is QuoteStatus => QUOTE_STATUSES.some((s) => s === v);

function isQuoteView(v: unknown): v is QuoteView {
  return (
    isRecord(v) &&
    typeof v.id === "string" &&
    typeof v.number === "string" &&
    isStatus(v.status) &&
    Array.isArray(v.items) &&
    isRecord(v.totals) &&
    typeof v.totals.total === "number" &&
    isRecord(v.customer)
  );
}

function isListEntry(v: unknown): v is QuoteListEntry {
  return isRecord(v) && typeof v.number === "string" && isStatus(v.status) && typeof v.total === "number";
}

/** Tool results arrive as untyped JSON from the host; this is the card's one parse point. */
export function readPayload(structured: unknown): Payload | null {
  if (!isRecord(structured)) return null;
  if (isQuoteView(structured.quote)) return { kind: "quote", quote: structured.quote };
  if (Array.isArray(structured.quotes) && structured.quotes.every(isListEntry)) {
    return { kind: "list", quotes: structured.quotes };
  }
  return null;
}
