import { createItemIdAssigner, type ItemContent } from "./ids.ts";
import { addDays, err, ok, transition, type Customer, type LineItem, type Quote, type Result } from "./quote.ts";

export type PercentField = "discountPercent" | "taxPercent" | "depositPercent";

export type ReviseOp =
  | { op: "add_item"; item: ItemContent; itemId?: string }
  | { op: "update_item"; itemId: string; changes: Partial<ItemContent> }
  | { op: "remove_item"; itemId: string }
  | { op: "set_customer"; name?: string; email?: string | null }
  | { op: "set_title"; title: string }
  | { op: "set_notes"; notes: string | null }
  | { op: "set_percent"; field: PercentField; percent: number }
  | { op: "set_valid_days"; days: number };

/**
 * Applies a revision: the `revise` transition (a sent quote returns to draft
 * as the next version), then each op in order. Pure, and converges when the
 * same op set is applied twice: added lines get content-derived ids and
 * re-adding one replaces it, and removing a missing line is a no-op.
 */
export function revise(quote: Quote, ops: readonly ReviseOp[], now: Date): Result<Quote> {
  const moved = transition(quote, "revise", now);
  if (!moved.ok) return moved;
  const nextId = createItemIdAssigner();
  let current = moved.value;
  for (const op of ops) {
    const next = applyOp(current, op, now, nextId);
    if (!next.ok) return next;
    current = next.value;
  }
  return ok(current);
}

function applyOp(quote: Quote, op: ReviseOp, now: Date, nextId: (item: ItemContent) => string): Result<Quote> {
  switch (op.op) {
    case "add_item": {
      const item: LineItem = { id: op.itemId ?? nextId(op.item), ...op.item };
      const exists = quote.items.some((it) => it.id === item.id);
      const items = exists ? quote.items.map((it) => (it.id === item.id ? item : it)) : [...quote.items, item];
      return ok({ ...quote, items });
    }
    case "update_item": {
      if (!quote.items.some((it) => it.id === op.itemId)) {
        return err({ kind: "item_not_found", itemId: op.itemId, number: quote.number });
      }
      return ok({ ...quote, items: quote.items.map((it) => (it.id === op.itemId ? { ...it, ...op.changes } : it)) });
    }
    case "remove_item":
      return ok({ ...quote, items: quote.items.filter((it) => it.id !== op.itemId) });
    case "set_customer": {
      const customer: Customer = { name: op.name ?? quote.customer.name };
      const email = op.email === undefined ? quote.customer.email : op.email;
      if (email) customer.email = email;
      return ok({ ...quote, customer });
    }
    case "set_title":
      return ok({ ...quote, title: op.title });
    case "set_notes": {
      const { notes: _old, ...rest } = quote;
      return ok(op.notes ? { ...rest, notes: op.notes } : rest);
    }
    case "set_percent":
      return ok({ ...quote, [op.field]: op.percent });
    case "set_valid_days":
      return ok({ ...quote, validUntil: addDays(now, op.days) });
    default: {
      const exhaustive: never = op;
      return exhaustive;
    }
  }
}
