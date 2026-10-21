import { dollarsToCents, type QuoteView, type ReviseOpInput } from "@billy/core";
import { Alert } from "@openai/apps-sdk-ui/components/Alert";
import { Button } from "@openai/apps-sdk-ui/components/Button";
import { Plus, SettingsSlider, Trash } from "@openai/apps-sdk-ui/components/Icon";
import { Input } from "@openai/apps-sdk-ui/components/Input";
import { SegmentedControl } from "@openai/apps-sdk-ui/components/SegmentedControl";
import { Select, type Option } from "@openai/apps-sdk-ui/components/Select";
import { Textarea } from "@openai/apps-sdk-ui/components/Textarea";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  blankRow,
  draftFromView,
  opsFromDraft,
  parseNumber,
  previewTotals,
  previewValidUntil,
  rowAmount,
  unitOptions,
  type DraftRow,
  type EditDraft,
} from "./edit-ops.ts";
import { day, money, quantity, STATUS_LABEL } from "./format.ts";
import { TotalsList } from "./inline.tsx";

/** Room for the host's composer, which overlays the bottom of a fullscreen frame. */
const COMPOSER_ROOM = 88;
/** The bottom bar's own height, so the last line can scroll clear of it. */
const BAR_ROOM = 72;

type Pane = "edit" | "customer";

export interface EditorProps {
  view: QuoteView;
  revision: number;
  locale: string | undefined;
  bottomInset: number;
  busy: boolean;
  notice: string | null;
  error: string | null;
  onSave: (ops: ReviseOpInput[]) => void;
  onDone: () => void;
}

function lineAmount(row: DraftRow): string {
  const amount = rowAmount(row);
  return amount === null ? "–" : money(amount);
}

function lineDetail(row: DraftRow, locale: string | undefined): string {
  const qty = parseNumber(row.quantity);
  const price = parseNumber(row.unitPrice);
  return `${Number.isFinite(qty) ? quantity(qty, locale) : row.quantity} ${row.unit} × ${price >= 0 ? money(dollarsToCents(price)) : row.unitPrice}`;
}

export function Editor(p: EditorProps) {
  const { view } = p;
  const [baseline, setBaseline] = useState(() => ({ revision: p.revision, draft: draftFromView(view) }));
  const [draft, setDraft] = useState(baseline.draft);
  const [errors, setErrors] = useState<string[]>([]);
  const [pane, setPane] = useState<Pane>("edit");
  const [settingsOpen, setSettingsOpen] = useState(false);
  if (baseline.revision !== p.revision) {
    const fresh = { revision: p.revision, draft: draftFromView(view) };
    setBaseline(fresh);
    setDraft(fresh.draft);
    setErrors([]);
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline.draft);
  const totals = previewTotals(view, draft);
  const patch = (fields: Partial<EditDraft>) => setDraft((d) => ({ ...d, ...fields }));
  const patchRow = (index: number, fields: Partial<DraftRow>) =>
    setDraft((d) => ({ ...d, rows: d.rows.map((r, i) => (i === index ? { ...r, ...fields } : r)) }));

  const save = () => {
    const result = opsFromDraft(view, draft);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors([]);
    if (result.ops.length) p.onSave(result.ops);
    else setDraft(baseline.draft);
  };

  const shown = (which: Pane) => (pane === which ? "" : "hidden min-[900px]:block");
  const bottomRoom = COMPOSER_ROOM + p.bottomInset;
  const scrollRoom = BAR_ROOM + bottomRoom + 16;

  // Keeps focused fields and scrolled-to content clear of the fixed bottom bar.
  useEffect(() => {
    const root = document.documentElement;
    root.style.scrollPaddingBottom = `${scrollRoom}px`;
    return () => {
      root.style.removeProperty("scroll-padding-bottom");
    };
  }, [scrollRoom]);
  const problems = [...errors, ...(p.error ? [p.error] : [])];

  return (
    <div className="min-h-dvh bg-surface-secondary text-default">
      <header className="border-b border-subtle bg-surface">
        <div className="mx-auto flex max-w-[1080px] flex-col gap-3 px-4 pt-4 pb-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="m-0 truncate text-xs text-secondary">
              {[view.number, STATUS_LABEL[view.status], draft.customerName.trim() || view.customer.name].join(" · ")}
            </p>
            <h1 className="m-0 heading-md">{view.title}</h1>
          </div>
          {view.status === "sent" && (
            <p className="m-0 text-sm text-secondary">
              Saving moves this sent quote back to draft as version {view.version + 1}. Send it again when you're ready.
            </p>
          )}
          <SegmentedControl aria-label="View" value={pane} onChange={setPane} block size="3xl" className="min-[900px]:hidden">
            <SegmentedControl.Option value="edit">Edit</SegmentedControl.Option>
            <SegmentedControl.Option value="customer">Customer view</SegmentedControl.Option>
          </SegmentedControl>
        </div>
      </header>

      <main
        className="mx-auto grid max-w-[1080px] items-start gap-4 px-4 pt-3 min-[900px]:grid-cols-[minmax(0,1fr)_minmax(0,400px)]"
        style={{ paddingBottom: scrollRoom }}
      >
        <section aria-label="Line items" className={shown("edit")}>
          <ol className="m-0 flex list-none flex-col gap-2 p-0">
            {draft.rows.map((row, index) => (
              <LineCard
                key={index}
                row={row}
                number={index + 1}
                onChange={(fields) => patchRow(index, fields)}
                onRemove={() => setDraft((d) => ({ ...d, rows: d.rows.filter((_, i) => i !== index) }))}
              />
            ))}
          </ol>
          <Button
            color="secondary"
            variant="outline"
            size="2xl"
            block
            className="mt-2"
            onClick={() => setDraft((d) => ({ ...d, rows: [...d.rows, blankRow()] }))}
          >
            <Plus />
            Add line
          </Button>
        </section>
        <section aria-label="Customer view" className={shown("customer")}>
          <CustomerPreview view={view} draft={draft} locale={p.locale} />
        </section>
      </main>

      <footer className="fixed inset-x-0 bottom-0 border-t border-subtle bg-surface" style={{ paddingBottom: bottomRoom }}>
        <div className="mx-auto flex max-w-[1080px] flex-col gap-2 px-4 py-2.5">
          {problems.length > 0 && (
            <div role="alert">
              <Alert
                color="danger"
                variant="soft"
                description={
                  <ul className="m-0 list-none p-0">
                    {problems.map((e) => (
                      <li key={e}>{e}</li>
                    ))}
                  </ul>
                }
              />
            </div>
          )}
          {p.notice && !dirty && (
            <p role="status" className="m-0 text-sm text-secondary">
              {p.notice}
            </p>
          )}
          <div className="flex items-center gap-2">
            <div className="flex min-w-0 flex-1 flex-col whitespace-nowrap tabular-nums">
              <span className="heading-md" data-total>
                {money(totals.total)}
              </span>
              <span className="truncate text-xs text-secondary">
                {totals.amountDue < totals.total ? `Deposit ${money(totals.amountDue)}` : "Paid in full"} · tax {draft.taxPercent || "0"}%
              </span>
            </div>
            <Button color="secondary" variant="outline" size="2xl" uniform aria-label="Quote settings" onClick={() => setSettingsOpen(true)}>
              <SettingsSlider />
            </Button>
            {dirty ? (
              <Button color="primary" size="2xl" className="min-w-[88px]" loading={p.busy} disabled={p.busy} onClick={save}>
                Save
              </Button>
            ) : (
              <Button color="secondary" variant="outline" size="2xl" className="min-w-[88px]" disabled={p.busy} onClick={p.onDone}>
                Done
              </Button>
            )}
          </div>
        </div>
      </footer>

      <SettingsSheet open={settingsOpen} onClose={() => setSettingsOpen(false)} draft={draft} patch={patch} bottomRoom={bottomRoom} />
    </div>
  );
}

function UnitTrigger({ label }: Option) {
  return (
    <>
      <span className="sr-only">Unit </span>
      {label}
    </>
  );
}

function LineCard({ row, number, onChange, onRemove }: { row: DraftRow; number: number; onChange: (fields: Partial<DraftRow>) => void; onRemove: () => void }) {
  const units = unitOptions(row.unit).map((u) => ({ value: u, label: u }));
  return (
    <li aria-label={`Line ${number}`} className="flex flex-col gap-2 rounded-xl border border-default bg-surface p-3">
      <div className="flex items-center gap-2">
        <Input
          aria-label={`Line ${number} description`}
          placeholder="Description"
          value={row.description}
          onChange={(e) => onChange({ description: e.target.value })}
          size="2xl"
          gutterSize="xs"
          opticallyAlign="start"
          className="min-w-0 flex-1 font-semibold [--input-outline-border-color-hover:var(--color-border)] [--input-outline-border-color:transparent]"
        />
        <span className="text-sm whitespace-nowrap tabular-nums">{lineAmount(row)}</span>
        <Button color="secondary" variant="ghost" size="2xl" uniform opticallyAlign="end" aria-label={`Remove line ${number}`} onClick={onRemove}>
          <Trash />
        </Button>
      </div>
      <div className="flex items-center gap-2 whitespace-nowrap" data-qty-row>
        <div className="flex min-w-0 flex-1" role="group" aria-label={`Line ${number} quantity and unit`}>
          <Input
            aria-label={`Line ${number} quantity`}
            inputMode="decimal"
            value={row.quantity}
            onChange={(e) => onChange({ quantity: e.target.value })}
            size="2xl"
            gutterSize="sm"
            className="min-w-0 flex-1 rounded-r-none [&_input]:text-right"
          />
          <div className="flex-none">
            <Select
              value={row.unit}
              options={units}
              onChange={(o) => onChange({ unit: o.value })}
              TriggerView={UnitTrigger}
              variant="soft"
              size="2xl"
              block={false}
              listMinWidth={120}
              triggerClassName="rounded-l-none"
            />
          </div>
        </div>
        <span aria-hidden="true" className="text-sm text-secondary">
          ×
        </span>
        <Input
          aria-label={`Line ${number} unit price in dollars`}
          inputMode="decimal"
          value={row.unitPrice}
          onChange={(e) => onChange({ unitPrice: e.target.value })}
          startAdornment={
            <span aria-hidden="true" className="text-secondary">
              $
            </span>
          }
          size="2xl"
          gutterSize="sm"
          className="min-w-0 flex-1 [&_input]:text-right"
        />
      </div>
    </li>
  );
}

function CustomerPreview({ view, draft, locale }: { view: QuoteView; draft: EditDraft; locale: string | undefined }) {
  const totals = previewTotals(view, draft);
  const percent = (text: string) => Number(text) || 0;
  const rows = draft.rows.filter((r) => r.description.trim() || r.unitPrice.trim());
  return (
    <article aria-label="What the customer sees" className="flex flex-col gap-3 rounded-2xl border border-default bg-surface p-4">
      <header className="flex flex-col gap-0.5">
        <p className="m-0 text-xs text-secondary">
          Quote {view.number}
          {view.version > 1 ? ` · version ${view.version}` : ""}
        </p>
        <h2 className="m-0 heading-sm">{view.title}</h2>
        <p className="m-0 text-xs text-secondary">
          Prepared for {draft.customerName.trim() || view.customer.name} · Valid until {day(previewValidUntil(view, draft), locale)}
        </p>
      </header>
      <ul className="m-0 list-none border-t border-subtle p-0">
        {rows.map((row, i) => (
          <li key={i} className="flex justify-between gap-3 border-b border-subtle py-2.5">
            <div className="flex min-w-0 flex-col">
              <span className="text-sm [overflow-wrap:anywhere]">{row.description}</span>
              <span className="text-xs text-secondary">{lineDetail(row, locale)}</span>
            </div>
            <span className="text-sm whitespace-nowrap tabular-nums">{lineAmount(row)}</span>
          </li>
        ))}
      </ul>
      <TotalsList
        view={{ taxPercent: percent(draft.taxPercent), discountPercent: percent(draft.discountPercent), depositPercent: percent(draft.depositPercent) }}
        totals={totals}
      />
      {draft.notes.trim() && <p className="m-0 text-sm [overflow-wrap:anywhere] whitespace-pre-line">{draft.notes.trim()}</p>}
      <div className="flex flex-col gap-2" data-customer-actions>
        <Button color="primary" size="2xl" block disabled>
          {percent(draft.depositPercent) > 0 ? "Accept and pay deposit" : "Accept and pay"}
        </Button>
        <Button color="secondary" variant="outline" size="2xl" block disabled>
          Decline
        </Button>
      </div>
    </article>
  );
}

function Field({ label, wide, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return (
    <label className={`flex min-w-0 flex-col gap-1.5 text-sm font-medium whitespace-nowrap text-secondary ${wide ? "col-span-2" : ""}`}>
      {label}
      {children}
    </label>
  );
}

function SettingsSheet({
  open,
  onClose,
  draft,
  patch,
  bottomRoom,
}: {
  open: boolean;
  onClose: () => void;
  draft: EditDraft;
  patch: (fields: Partial<EditDraft>) => void;
  bottomRoom: number;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const text = (key: keyof Omit<EditDraft, "rows">, extra: Partial<React.ComponentProps<typeof Input>> = {}) => (
    <Input size="2xl" value={draft[key]} onChange={(e) => patch({ [key]: e.target.value })} {...extra} />
  );
  const number = (key: keyof Omit<EditDraft, "rows">, mode: "decimal" | "numeric" = "decimal") =>
    text(key, { inputMode: mode, className: "[&_input]:text-right" });

  return (
    <dialog
      ref={ref}
      aria-labelledby="settings-title"
      onClose={onClose}
      onClick={(e) => e.target === e.currentTarget && onClose()}
      className="mx-auto mt-auto mb-0 max-h-dvh w-full max-w-[640px] overflow-y-auto rounded-t-2xl bg-surface p-0 text-default backdrop:bg-black/40"
    >
      <div className="flex flex-col gap-4 px-4 pt-3" style={{ paddingBottom: bottomRoom }}>
        <div aria-hidden="true" className="mx-auto h-1 w-9 rounded-full bg-[var(--color-border)]" />
        <div className="flex items-center justify-between gap-2">
          <h2 id="settings-title" className="m-0 heading-sm whitespace-nowrap">
            Quote settings
          </h2>
          <Button color="secondary" variant="ghost" size="2xl" opticallyAlign="end" onClick={onClose}>
            Close
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Customer name" wide>
            {text("customerName", { autoComplete: "off" })}
          </Field>
          <Field label="Customer email" wide>
            {text("customerEmail", { type: "email", autoComplete: "off" })}
          </Field>
          <Field label="Tax %">{number("taxPercent")}</Field>
          <Field label="Discount %">{number("discountPercent")}</Field>
          <Field label="Deposit %">{number("depositPercent")}</Field>
          <Field label="Valid for (days)">{number("validDays", "numeric")}</Field>
          <Field label="Note to customer" wide>
            <Textarea rows={2} autoResize maxRows={6} value={draft.notes} onChange={(e) => patch({ notes: e.target.value })} />
          </Field>
        </div>
      </div>
    </dialog>
  );
}
