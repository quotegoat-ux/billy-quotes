import { formatUSD, type Cents } from "./money.ts";
import { isExpired, type LineItem, type Quote } from "./quote.ts";
import { computeTotals, lineAmount, type Totals } from "./totals.ts";

export interface QuoteLinks {
  quote: string;
  pay: string;
}

/** What tools return as structuredContent and what the card renders. No owner id. */
export interface QuoteView extends Omit<Quote, "ownerId" | "items"> {
  items: Array<LineItem & { amount: Cents }>;
  totals: Totals;
  expired: boolean;
  /** Present once the quote has been sent; a draft has no public page. */
  links?: QuoteLinks;
}

export function publicLinks(baseUrl: string, publicToken: string): QuoteLinks {
  const base = baseUrl.replace(/\/+$/, "");
  return { quote: `${base}/q/${publicToken}`, pay: `${base}/pay/${publicToken}` };
}

export function toQuoteView(quote: Quote, opts: { baseUrl: string; now: Date }): QuoteView {
  const { ownerId: _ownerId, items, ...rest } = quote;
  const view: QuoteView = {
    ...rest,
    items: items.map((item) => ({ ...item, amount: lineAmount(item) })),
    totals: computeTotals(quote),
    expired: isExpired(quote, opts.now),
  };
  if (quote.status !== "draft") view.links = publicLinks(opts.baseUrl, quote.publicToken);
  return view;
}

export function displayStatus(view: Pick<QuoteView, "status" | "expired">): string {
  const pending = view.status === "draft" || view.status === "sent";
  return pending && view.expired ? `${view.status}, expired` : view.status;
}

/** The plain-text answer a host without the card shows. */
export function describeQuote(view: QuoteView): string {
  const { totals } = view;
  const lines = [
    `${view.number} v${view.version} (${displayStatus(view)}) for ${view.customer.name}: ${view.title}`,
    ...view.items.map(
      (it) => `- ${it.description}: ${it.quantity} ${it.unit} x ${formatUSD(it.unitPrice)} = ${formatUSD(it.amount)} [${it.id}]`,
    ),
    `Subtotal ${formatUSD(totals.subtotal)}` +
      (totals.discount ? `, discount ${view.discountPercent}% -${formatUSD(totals.discount)}` : "") +
      (view.taxPercent ? `, tax ${view.taxPercent}% ${formatUSD(totals.tax)}` : "") +
      `, total ${formatUSD(totals.total)}.`,
    view.depositPercent ? `Deposit due ${formatUSD(totals.amountDue)} (${view.depositPercent}%).` : `Due ${formatUSD(totals.amountDue)}.`,
    `Valid until ${view.validUntil}.`,
  ];
  if (view.links) lines.push(`Customer link: ${view.links.quote}`, `Pay link: ${view.links.pay}`);
  return lines.join("\n");
}

export interface QuoteListEntry {
  id: string;
  number: string;
  status: Quote["status"];
  expired: boolean;
  title: string;
  customer: string;
  total: Cents;
  sentAt?: string;
}

export function toListEntry(quote: Quote, now: Date): QuoteListEntry {
  const entry: QuoteListEntry = {
    id: quote.id,
    number: quote.number,
    status: quote.status,
    expired: isExpired(quote, now),
    title: quote.title,
    customer: quote.customer.name,
    total: computeTotals(quote).total,
  };
  if (quote.sentAt) entry.sentAt = quote.sentAt;
  return entry;
}

export function describeList(entries: readonly QuoteListEntry[]): string {
  if (entries.length === 0) return "No quotes match.";
  return entries
    .map((e) => `${e.number} (${displayStatus(e)}) ${e.customer}: ${e.title}, ${formatUSD(e.total)}${e.sentAt ? `, sent ${e.sentAt.slice(0, 10)}` : ""}`)
    .join("\n");
}
