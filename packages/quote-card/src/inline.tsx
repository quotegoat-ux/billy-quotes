import type { QuoteListEntry, QuoteStatus, QuoteView, Totals } from "@billy/core";
import { Badge, type BadgeProps } from "@openai/apps-sdk-ui/components/Badge";
import { Button } from "@openai/apps-sdk-ui/components/Button";
import { day, money, quantity, STATUS_LABEL } from "./format.ts";

export const INLINE_ITEM_LIMIT = 5;

export interface Action {
  label: string;
  busyLabel?: string;
  run: () => void;
}

const BADGE: Record<QuoteStatus | "expired", Pick<BadgeProps, "color" | "variant">> = {
  draft: { color: "secondary" },
  sent: { color: "info" },
  accepted: { color: "success" },
  paid: { color: "success", variant: "solid" },
  declined: { color: "danger" },
  expired: { color: "warning" },
};

export function StatusBadge({ view }: { view: Pick<QuoteView, "status" | "expired"> }) {
  const expired = (view.status === "draft" || view.status === "sent") && view.expired;
  return (
    <Badge size="md" className="whitespace-nowrap" {...BADGE[expired ? "expired" : view.status]}>
      {expired ? `${STATUS_LABEL[view.status]} · Expired` : STATUS_LABEL[view.status]}
    </Badge>
  );
}

export function TotalsList({ view, totals }: { view: Pick<QuoteView, "discountPercent" | "taxPercent" | "depositPercent">; totals: Totals }) {
  const row = (label: string, value: string, strong = false) => (
    <div className={`flex justify-between gap-3 ${strong ? "text-default font-semibold" : "text-secondary"}`}>
      <dt>{label}</dt>
      <dd className="m-0 whitespace-nowrap">{value}</dd>
    </div>
  );
  return (
    <dl className="m-0 grid gap-1 text-sm tabular-nums">
      {row("Subtotal", money(totals.subtotal))}
      {totals.discount > 0 && row(`Discount (${view.discountPercent}%)`, `−${money(totals.discount)}`)}
      {view.taxPercent > 0 && row(`Tax (${view.taxPercent}%)`, money(totals.tax))}
      {row("Total", money(totals.total), true)}
      {view.depositPercent > 0 && row(`Deposit due (${view.depositPercent}%)`, money(totals.amountDue), true)}
    </dl>
  );
}

function LineRow({ main, detail, side }: { main: string; detail: string; side: React.ReactNode }) {
  return (
    <li className="flex justify-between gap-3 border-b border-subtle py-2.5">
      <div className="flex min-w-0 flex-col">
        <span className="text-sm [overflow-wrap:anywhere]">{main}</span>
        <span className="text-xs text-secondary">{detail}</span>
      </div>
      {side}
    </li>
  );
}

function MoreRow({ hidden, noun }: { hidden: number; noun: string }) {
  return hidden > 0 ? <li className="border-b border-subtle py-2.5 text-xs text-secondary">{`+${hidden} more${noun}`}</li> : null;
}

export interface InlineProps {
  view: QuoteView;
  locale: string | undefined;
  busy: boolean;
  notice: string | null;
  error: string | null;
  primary?: Action | undefined;
  secondary?: Action | undefined;
}

export function InlineCard({ view, locale, busy, notice, error, primary, secondary }: InlineProps) {
  const shown = view.items.slice(0, INLINE_ITEM_LIMIT);
  const hidden = view.items.length - shown.length;
  const pending = view.status === "draft" || view.status === "sent";
  const validity = `${pending && view.expired ? "Expired" : "Valid until"} ${day(view.validUntil, locale)}`;
  const label = (a: Action) => (busy && a.busyLabel ? a.busyLabel : a.label);
  return (
    <article aria-label={`Quote ${view.number}`} className="p-4 text-default">
      <header className="flex flex-col gap-1">
        <div className="flex items-center gap-2 text-sm text-secondary">
          <span className="font-semibold text-default">{view.number}</span>
          {view.version > 1 && <span className="tabular-nums">v{view.version}</span>}
          <StatusBadge view={view} />
        </div>
        <h1 className="m-0 heading-sm">{view.title}</h1>
        <p className="m-0 text-sm text-secondary">{view.customer.name}</p>
      </header>
      <ul className="mt-3 list-none border-t border-subtle p-0">
        {shown.map((it) => (
          <LineRow
            key={it.id}
            main={it.description}
            detail={`${quantity(it.quantity, locale)} ${it.unit} × ${money(it.unitPrice)}`}
            side={<span className="text-sm whitespace-nowrap tabular-nums">{money(it.amount)}</span>}
          />
        ))}
        <MoreRow hidden={hidden} noun={` item${hidden === 1 ? "" : "s"}`} />
      </ul>
      <div className="mt-3">
        <TotalsList view={view} totals={view.totals} />
      </div>
      <p className="mt-3 mb-0 text-xs text-secondary">{validity}</p>
      {error && (
        <p role="alert" className="mt-3 mb-0 text-sm text-danger">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="mt-3 mb-0 text-sm text-secondary">
          {notice}
        </p>
      )}
      {(primary || secondary) && (
        <div className="mt-4 flex flex-wrap gap-2">
          {primary && (
            <Button color="primary" size="2xl" disabled={busy} onClick={primary.run}>
              {label(primary)}
            </Button>
          )}
          {secondary && (
            <Button color="secondary" variant="outline" size="2xl" disabled={busy} onClick={secondary.run}>
              {label(secondary)}
            </Button>
          )}
        </div>
      )}
    </article>
  );
}

export function QuoteList({ quotes }: { quotes: QuoteListEntry[] }) {
  const shown = quotes.slice(0, INLINE_ITEM_LIMIT);
  const hidden = quotes.length - shown.length;
  return (
    <article aria-label="Quotes" className="p-4 text-default">
      <h1 className="m-0 heading-sm">{quotes.length ? `${quotes.length} quote${quotes.length === 1 ? "" : "s"}` : "No quotes match"}</h1>
      <ul className="mt-3 list-none border-t border-subtle p-0">
        {shown.map((q) => (
          <LineRow
            key={q.number}
            main={`${q.number} · ${q.customer}`}
            detail={q.title}
            side={
              <div className="flex flex-col items-end gap-1">
                <span className="text-sm whitespace-nowrap tabular-nums">{money(q.total)}</span>
                <StatusBadge view={q} />
              </div>
            }
          />
        ))}
        <MoreRow hidden={hidden} noun="" />
      </ul>
    </article>
  );
}
