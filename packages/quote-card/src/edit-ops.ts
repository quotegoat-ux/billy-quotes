import {
  computeTotals,
  dollarsToCents,
  normalizeUnit,
  reviseOpInput,
  type QuoteView,
  type ReviseOpInput,
  type Totals,
} from "@billy/core";

export interface DraftRow {
  /** Absent for a line added in the editor. */
  id?: string;
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string;
}

export interface EditDraft {
  customerName: string;
  customerEmail: string;
  notes: string;
  depositPercent: string;
  rows: DraftRow[];
}

export function draftFromView(view: QuoteView): EditDraft {
  return {
    customerName: view.customer.name,
    customerEmail: view.customer.email ?? "",
    notes: view.notes ?? "",
    depositPercent: String(view.depositPercent),
    rows: view.items.map((it) => ({
      id: it.id,
      description: it.description,
      quantity: String(it.quantity),
      unit: it.unit,
      unitPrice: (it.unitPrice / 100).toFixed(2),
    })),
  };
}

export function blankRow(): DraftRow {
  return { description: "", quantity: "1", unit: "each", unitPrice: "" };
}

export type OpsResult = { ok: true; ops: ReviseOpInput[] } | { ok: false; errors: string[] };

const parseNumber = (text: string): number => (text.trim() === "" ? Number.NaN : Number(text.replace(/[$,\s]/g, "")));

/**
 * Turns the editor's form into revise_quote ops, changing only what the user
 * changed. Each op is checked against the same schema the server enforces so
 * the user sees a problem before saving; the server still decides.
 */
export function opsFromDraft(view: QuoteView, draft: EditDraft): OpsResult {
  const ops: ReviseOpInput[] = [];
  const errors: string[] = [];
  const check = (candidate: unknown, label: string) => {
    const parsed = reviseOpInput.safeParse(candidate);
    if (parsed.success) ops.push(parsed.data);
    else errors.push(`${label}: ${parsed.error.issues.map((i) => `${i.path.join(".") || "value"} ${i.message}`).join(", ")}`);
  };

  const kept = new Set(draft.rows.flatMap((r) => (r.id ? [r.id] : [])));
  for (const item of view.items) if (!kept.has(item.id)) ops.push({ op: "remove_item", item_id: item.id });

  draft.rows.forEach((row, index) => {
    const label = `Line ${index + 1}`;
    const quantity = parseNumber(row.quantity);
    const unitPrice = parseNumber(row.unitPrice);
    if (!Number.isFinite(quantity) || !Number.isFinite(unitPrice)) {
      errors.push(`${label}: enter a number for ${Number.isFinite(quantity) ? "unit price" : "quantity"}`);
      return;
    }
    const unit = normalizeUnit(row.unit);
    const original = row.id ? view.items.find((it) => it.id === row.id) : undefined;
    if (!original) {
      check({ op: "add_item", description: row.description.trim(), quantity, unit, unit_price: unitPrice }, label);
      return;
    }
    const changes: Record<string, unknown> = {};
    if (row.description.trim() !== original.description) changes.description = row.description.trim();
    if (quantity !== original.quantity) changes.quantity = quantity;
    if (unit !== original.unit) changes.unit = unit;
    if (dollarsToCentsOrNull(unitPrice) !== original.unitPrice) changes.unit_price = unitPrice;
    if (Object.keys(changes).length) check({ op: "update_item", item_id: original.id, ...changes }, label);
  });

  const name = draft.customerName.trim();
  const email = draft.customerEmail.trim();
  if (name !== view.customer.name || email !== (view.customer.email ?? "")) {
    check({ op: "set_customer", name, email }, "Customer");
  }
  if (draft.notes.trim() !== (view.notes ?? "")) check({ op: "set_notes", notes: draft.notes.trim() }, "Notes");
  const deposit = parseNumber(draft.depositPercent || "0");
  if (deposit !== view.depositPercent) check({ op: "set_deposit_percent", percent: deposit }, "Deposit");

  return errors.length ? { ok: false, errors } : { ok: true, ops };
}

function dollarsToCentsOrNull(dollars: number): number | null {
  return dollars >= 0 ? dollarsToCents(dollars) : null;
}

/** Live preview while editing. Skips rows that don't parse yet; the server's totals replace this on save. */
export function previewTotals(view: QuoteView, draft: EditDraft): Totals {
  const items = draft.rows.flatMap((row, i) => {
    const quantity = parseNumber(row.quantity);
    const price = parseNumber(row.unitPrice);
    if (!(quantity > 0) || !(price >= 0)) return [];
    return [{ id: row.id ?? `new-${i}`, description: row.description, unit: row.unit, quantity, unitPrice: dollarsToCents(price) }];
  });
  const deposit = parseNumber(draft.depositPercent || "0");
  return computeTotals({
    items,
    discountPercent: view.discountPercent,
    taxPercent: view.taxPercent,
    depositPercent: deposit >= 0 && deposit <= 100 ? deposit : view.depositPercent,
  });
}
