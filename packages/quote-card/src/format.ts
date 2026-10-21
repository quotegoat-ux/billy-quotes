import { formatUSD, type Cents, type QuoteStatus } from "@billy/core";

export const money = (amount: Cents): string => formatUSD(amount);

export function quantity(n: number, locale: string | undefined): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 3 }).format(n);
}

export function day(isoDate: string, locale: string | undefined): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(date);
}

export const STATUS_LABEL: Record<QuoteStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  accepted: "Accepted",
  paid: "Paid",
  declined: "Declined",
};
