import type { LineItem } from "./quote.ts";

const NUMBER_PREFIX = "Q-";
const NUMBER_OFFSET = 1000;

/** seq 1 is "Q-1001". */
export function formatQuoteNumber(seq: number): string {
  return `${NUMBER_PREFIX}${NUMBER_OFFSET + seq}`;
}

export function parseQuoteNumber(text: string): number | undefined {
  const match = /^q-?(\d+)$/i.exec(text.trim());
  if (!match) return undefined;
  const seq = Number(match[1]) - NUMBER_OFFSET;
  return Number.isSafeInteger(seq) && seq > 0 ? seq : undefined;
}

export type ItemContent = Omit<LineItem, "id">;

/**
 * Line ids derive from content plus how many identical lines came before it
 * in the same batch. Replaying the same revise ops therefore produces the same
 * ids, which is what makes revise_quote safe to retry.
 */
export function itemIdFor(item: ItemContent, occurrence: number): string {
  const key = [item.description, item.quantity, item.unit, item.unitPrice, occurrence].join("\u0000");
  return `li_${fnv1a52(key).toString(36)}`;
}

/** Hands out content-derived ids, counting identical lines within one batch. */
export function createItemIdAssigner(): (item: ItemContent) => string {
  const seen = new Map<string, number>();
  return (item) => {
    const contentKey = itemIdFor(item, 0);
    const occurrence = seen.get(contentKey) ?? 0;
    seen.set(contentKey, occurrence + 1);
    return itemIdFor(item, occurrence);
  };
}

export function assignItemIds(items: readonly ItemContent[]): LineItem[] {
  const nextId = createItemIdAssigner();
  return items.map((item) => ({ id: nextId(item), ...item }));
}

function fnv1a52(text: string): number {
  let hash = 0xcbf29ce484222325n;
  for (let i = 0; i < text.length; i++) {
    hash ^= BigInt(text.charCodeAt(i));
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return Number(hash >> 12n);
}
