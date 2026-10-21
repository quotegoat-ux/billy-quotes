import type { QuoteListEntry, QuoteView, Totals } from "@billy/core";
import { h } from "./dom.ts";
import type { DraftRow, EditDraft } from "./edit-ops.ts";
import { day, money, quantity, STATUS_LABEL } from "./format.ts";

export const INLINE_ITEM_LIMIT = 5;

export interface Action {
  label: string;
  busyLabel?: string;
  run: () => void;
}

export interface InlineProps {
  view: QuoteView;
  locale: string | undefined;
  busy: boolean;
  notice: string | null;
  error: string | null;
  primary?: Action;
  secondary?: Action;
}

function statusPill(view: Pick<QuoteView, "status" | "expired">) {
  const pending = view.status === "draft" || view.status === "sent";
  const expired = pending && view.expired;
  return h(
    "span",
    { class: `pill pill-${expired ? "expired" : view.status}` },
    expired ? `${STATUS_LABEL[view.status]} · Expired` : STATUS_LABEL[view.status],
  );
}

function totalsBlock(view: QuoteView, totals: Totals) {
  const row = (label: string, value: string, cls = "") => h("div", { class: `trow ${cls}` }, h("span", {}, label), h("span", {}, value));
  return h(
    "div",
    { class: "totals" },
    row("Subtotal", money(totals.subtotal)),
    totals.discount > 0 && row(`Discount (${view.discountPercent}%)`, `−${money(totals.discount)}`),
    view.taxPercent > 0 && row(`Tax (${view.taxPercent}%)`, money(totals.tax)),
    row("Total", money(totals.total), "trow-total"),
    view.depositPercent > 0 && row(`Deposit due (${view.depositPercent}%)`, money(totals.amountDue), "trow-due"),
  );
}

function button(action: Action, kind: "primary" | "secondary", busy: boolean) {
  return h(
    "button",
    { type: "button", class: `btn btn-${kind}`, disabled: busy, onclick: () => action.run() },
    busy && action.busyLabel ? action.busyLabel : action.label,
  );
}

export function renderInline(p: InlineProps): HTMLElement {
  const { view, locale } = p;
  const shown = view.items.slice(0, INLINE_ITEM_LIMIT);
  const hidden = view.items.length - shown.length;
  const validity = view.expired && (view.status === "draft" || view.status === "sent")
    ? `Expired ${day(view.validUntil, locale)}`
    : `Valid until ${day(view.validUntil, locale)}`;
  return h(
    "article",
    { class: "card", "aria-label": `Quote ${view.number}` },
    h(
      "header",
      { class: "head" },
      h("div", { class: "meta" }, h("span", { class: "number" }, view.number), view.version > 1 && h("span", { class: "version" }, `v${view.version}`), statusPill(view)),
      h("h1", { class: "title" }, view.title),
      h("p", { class: "customer" }, view.customer.name),
    ),
    h(
      "ul",
      { class: "items" },
      ...shown.map((it) =>
        h(
          "li",
          { class: "item" },
          h("div", { class: "item-main" }, h("span", { class: "item-desc" }, it.description), h("span", { class: "item-qty" }, `${quantity(it.quantity, locale)} ${it.unit} × ${money(it.unitPrice)}`)),
          h("span", { class: "item-amt" }, money(it.amount)),
        ),
      ),
      hidden > 0 && h("li", { class: "more" }, `+${hidden} more item${hidden === 1 ? "" : "s"}`),
    ),
    totalsBlock(view, view.totals),
    h("p", { class: "validity" }, validity),
    p.error && h("p", { class: "error", role: "alert" }, p.error),
    p.notice && h("p", { class: "notice", role: "status" }, p.notice),
    (p.primary || p.secondary) &&
      h("div", { class: "actions" }, p.primary && button(p.primary, "primary", p.busy), p.secondary && button(p.secondary, "secondary", p.busy)),
  );
}

export function renderList(quotes: QuoteListEntry[]): HTMLElement {
  const shown = quotes.slice(0, INLINE_ITEM_LIMIT);
  const hidden = quotes.length - shown.length;
  return h(
    "article",
    { class: "card", "aria-label": "Quotes" },
    h("h1", { class: "title" }, quotes.length ? `${quotes.length} quote${quotes.length === 1 ? "" : "s"}` : "No quotes match"),
    h(
      "ul",
      { class: "items" },
      ...shown.map((q) =>
        h(
          "li",
          { class: "item" },
          h("div", { class: "item-main" }, h("span", { class: "item-desc" }, `${q.number} · ${q.customer}`), h("span", { class: "item-qty" }, q.title)),
          h("div", { class: "item-side" }, h("span", { class: "item-amt" }, money(q.total)), statusPill(q)),
        ),
      ),
      hidden > 0 && h("li", { class: "more" }, `+${hidden} more`),
    ),
  );
}

export interface EditorProps {
  view: QuoteView;
  draft: EditDraft;
  busy: boolean;
  errors: string[];
  error: string | null;
  notice: string | null;
  bottomInset: number;
  onChange: () => void;
  onAddRow: () => void;
  onRemoveRow: (index: number) => void;
  onSave: () => void;
  onDone: () => void;
}

function field(label: string, input: HTMLInputElement | HTMLTextAreaElement) {
  return h("label", { class: "field" }, h("span", { class: "field-label" }, label), input);
}

function bind<T extends HTMLInputElement | HTMLTextAreaElement>(el: T, get: () => string, set: (v: string) => void, onChange: () => void): T {
  el.value = get();
  el.addEventListener("input", () => {
    set(el.value);
    onChange();
  });
  return el;
}

export function renderEditor(p: EditorProps): HTMLElement {
  const { view, draft } = p;
  const input = (attrs: Record<string, string>) => h("input", { type: "text", ...attrs });
  const rowEl = (row: DraftRow, index: number) =>
    h(
      "tr",
      {},
      h("td", {}, bind(input({ "aria-label": `Line ${index + 1} description`, class: "in-desc" }), () => row.description, (v) => (row.description = v), p.onChange)),
      h("td", {}, bind(input({ "aria-label": `Line ${index + 1} quantity`, inputmode: "decimal", class: "in-num" }), () => row.quantity, (v) => (row.quantity = v), p.onChange)),
      h("td", {}, bind(input({ "aria-label": `Line ${index + 1} unit`, class: "in-unit" }), () => row.unit, (v) => (row.unit = v), p.onChange)),
      h("td", {}, bind(input({ "aria-label": `Line ${index + 1} unit price in dollars`, inputmode: "decimal", class: "in-num" }), () => row.unitPrice, (v) => (row.unitPrice = v), p.onChange)),
      h("td", {}, h("button", { type: "button", class: "btn-icon", "aria-label": `Remove line ${index + 1}`, onclick: () => p.onRemoveRow(index) }, "×")),
    );

  return h(
    "section",
    { class: "editor", style: `padding-bottom:${120 + p.bottomInset}px` },
    h(
      "header",
      { class: "editor-head" },
      h("div", {}, h("div", { class: "meta" }, h("span", { class: "number" }, `Edit ${view.number}`), statusPill(view)), h("h1", { class: "title" }, view.title)),
      h("button", { type: "button", class: "btn btn-secondary", onclick: () => p.onDone() }, "Done"),
    ),
    view.status === "sent" &&
      h("p", { class: "notice" }, `Saving moves this sent quote back to draft as version ${view.version + 1}. Send it again when you're ready.`),
    h(
      "div",
      { class: "grid2" },
      field("Customer", bind(input({ autocomplete: "off" }), () => draft.customerName, (v) => (draft.customerName = v), p.onChange)),
      field("Customer email", bind(input({ type: "email", autocomplete: "off" }), () => draft.customerEmail, (v) => (draft.customerEmail = v), p.onChange)),
    ),
    h(
      "table",
      { class: "lines" },
      h("thead", {}, h("tr", {}, h("th", {}, "Description"), h("th", {}, "Qty"), h("th", {}, "Unit"), h("th", {}, "Unit price ($)"), h("th", { "aria-label": "Remove" }))),
      h("tbody", {}, ...draft.rows.map(rowEl)),
    ),
    h("button", { type: "button", class: "btn btn-secondary add-row", onclick: () => p.onAddRow() }, "Add line"),
    h(
      "div",
      { class: "grid2" },
      field("Notes", bind(h("textarea", { rows: 3 }), () => draft.notes, (v) => (draft.notes = v), p.onChange)),
      field("Deposit %", bind(input({ inputmode: "decimal", class: "in-num" }), () => draft.depositPercent, (v) => (draft.depositPercent = v), p.onChange)),
    ),
    h("div", { id: "preview" }),
    (p.errors.length > 0 || p.error) &&
      h("ul", { class: "error", role: "alert" }, ...[...p.errors, p.error].map((e) => e && h("li", {}, e))),
    p.notice && h("p", { class: "notice", role: "status" }, p.notice),
    h("div", { class: "actions" }, h("button", { type: "button", class: "btn btn-primary", disabled: p.busy, onclick: () => p.onSave() }, p.busy ? "Saving…" : "Save")),
  );
}

export function renderPreview(view: QuoteView, totals: Totals, depositPercent: number): HTMLElement {
  return totalsBlock({ ...view, depositPercent }, totals);
}
