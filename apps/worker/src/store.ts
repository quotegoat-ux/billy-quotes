import {
  QUOTE_STATUSES,
  cents,
  computeTotals,
  formatQuoteNumber,
  parseQuoteNumber,
  type Quote,
  type QuoteStatus,
} from "@billy/core";
import { z } from "zod";

/** A quote plus the row revision that a compare-and-set update must match. */
export interface Stored {
  quote: Quote;
  rev: number;
}

export interface PriceStat {
  description: string;
  unit: string;
  last: number;
  min: number;
  max: number;
  count: number;
  lastQuotedAt: string;
}

export interface ListFilter {
  status?: QuoteStatus;
  openOlderThanDays?: number;
  limit: number;
  now: Date;
}

const storedItems = z.array(
  z.object({
    id: z.string(),
    description: z.string(),
    quantity: z.number().positive(),
    unit: z.string(),
    unitPrice: z.int().nonnegative().transform(cents),
  }),
);

const row = z.object({
  id: z.string(),
  owner_id: z.string(),
  seq: z.number(),
  version: z.number(),
  status: z.enum(QUOTE_STATUSES),
  title: z.string(),
  customer_name: z.string(),
  customer_email: z.string().nullable(),
  items: z.string(),
  discount_percent: z.number(),
  tax_percent: z.number(),
  deposit_percent: z.number(),
  notes: z.string().nullable(),
  valid_until: z.string(),
  public_token: z.string(),
  source_name: z.string().nullable(),
  source_url: z.string().nullable(),
  created_at: z.string(),
  sent_at: z.string().nullable(),
  accepted_at: z.string().nullable(),
  paid_at: z.string().nullable(),
  rev: z.number(),
});

function fromRow(raw: unknown): Stored {
  const r = row.parse(raw);
  const quote: Quote = {
    id: r.id,
    ownerId: r.owner_id,
    number: formatQuoteNumber(r.seq),
    version: r.version,
    status: r.status,
    title: r.title,
    customer: r.customer_email ? { name: r.customer_name, email: r.customer_email } : { name: r.customer_name },
    currency: "USD",
    items: storedItems.parse(JSON.parse(r.items)),
    discountPercent: r.discount_percent,
    taxPercent: r.tax_percent,
    depositPercent: r.deposit_percent,
    validUntil: r.valid_until,
    publicToken: r.public_token,
    createdAt: r.created_at,
  };
  if (r.notes) quote.notes = r.notes;
  if (r.source_name) quote.source = r.source_url ? { name: r.source_name, url: r.source_url } : { name: r.source_name };
  if (r.sent_at) quote.sentAt = r.sent_at;
  if (r.accepted_at) quote.acceptedAt = r.accepted_at;
  if (r.paid_at) quote.paidAt = r.paid_at;
  return { quote, rev: r.rev };
}

/** Column values for every field a write may change. Totals are derived here so no caller can store its own. */
function columns(q: Quote) {
  const totals = computeTotals(q);
  return {
    version: q.version,
    status: q.status,
    title: q.title,
    customer_name: q.customer.name,
    customer_email: q.customer.email ?? null,
    items: JSON.stringify(q.items),
    discount_percent: q.discountPercent,
    tax_percent: q.taxPercent,
    deposit_percent: q.depositPercent,
    subtotal_cents: totals.subtotal,
    total_cents: totals.total,
    amount_due_cents: totals.amountDue,
    notes: q.notes ?? null,
    valid_until: q.validUntil,
    sent_at: q.sentAt ?? null,
    accepted_at: q.acceptedAt ?? null,
    paid_at: q.paidAt ?? null,
  };
}

const MAX_SEQ_RETRIES = 5;

export class QuoteStore {
  constructor(private readonly db: D1Database) {}

  /**
   * Inserts a new quote with the owner's next sequence number. Two concurrent
   * creates can pick the same number; UNIQUE(owner_id, seq) rejects the loser,
   * which then retries with the next one.
   */
  async create(ownerId: string, build: (seq: number) => Quote): Promise<Quote> {
    for (let attempt = 0; attempt < MAX_SEQ_RETRIES; attempt++) {
      const next = await this.db
        .prepare("SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM quotes WHERE owner_id = ?")
        .bind(ownerId)
        .first<{ seq: number }>();
      const seq = next?.seq ?? 1;
      const quote = build(seq);
      const c = columns(quote);
      try {
        await this.db
          .prepare(
            `INSERT INTO quotes (id, owner_id, seq, version, status, title, customer_name, customer_email, currency, items,
               discount_percent, tax_percent, deposit_percent, subtotal_cents, total_cents, amount_due_cents, notes,
               valid_until, public_token, source_name, source_url, created_at, sent_at, accepted_at, paid_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'USD', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            quote.id, ownerId, seq, c.version, c.status, c.title, c.customer_name, c.customer_email, c.items,
            c.discount_percent, c.tax_percent, c.deposit_percent, c.subtotal_cents, c.total_cents, c.amount_due_cents,
            c.notes, c.valid_until, quote.publicToken, quote.source?.name ?? null, quote.source?.url ?? null,
            quote.createdAt, c.sent_at, c.accepted_at, c.paid_at,
          )
          .run();
        return quote;
      } catch (error) {
        if (!String(error).includes("UNIQUE constraint failed: quotes.owner_id, quotes.seq")) throw error;
      }
    }
    throw new Error("Could not allocate a quote number; try again.");
  }

  /** `ref` is a quote id or a number such as "Q-1001". */
  async get(ownerId: string, ref: string): Promise<Stored | null> {
    const seq = parseQuoteNumber(ref);
    const stmt =
      seq === undefined
        ? this.db.prepare("SELECT * FROM quotes WHERE owner_id = ? AND id = ?").bind(ownerId, ref.trim())
        : this.db.prepare("SELECT * FROM quotes WHERE owner_id = ? AND seq = ?").bind(ownerId, seq);
    const found = await stmt.first();
    return found ? fromRow(found) : null;
  }

  async getById(id: string): Promise<Stored | null> {
    const found = await this.db.prepare("SELECT * FROM quotes WHERE id = ?").bind(id).first();
    return found ? fromRow(found) : null;
  }

  async getByToken(publicToken: string): Promise<Stored | null> {
    const found = await this.db.prepare("SELECT * FROM quotes WHERE public_token = ?").bind(publicToken).first();
    return found ? fromRow(found) : null;
  }

  async list(ownerId: string, filter: ListFilter): Promise<Quote[]> {
    const where = ["owner_id = ?"];
    const args: unknown[] = [ownerId];
    if (filter.status) {
      where.push("status = ?");
      args.push(filter.status);
    }
    if (filter.openOlderThanDays !== undefined) {
      where.push("status IN ('sent', 'accepted')", "sent_at <= ?");
      args.push(new Date(filter.now.getTime() - filter.openOlderThanDays * 86_400_000).toISOString());
    }
    const { results } = await this.db
      .prepare(`SELECT * FROM quotes WHERE ${where.join(" AND ")} ORDER BY seq DESC LIMIT ?`)
      .bind(...args, filter.limit)
      .all();
    return results.map((r) => fromRow(r).quote);
  }

  /** Compare-and-set: writes only if nobody else wrote since `stored` was read. */
  async update(stored: Stored, next: Quote): Promise<boolean> {
    const c = columns(next);
    const result = await this.db
      .prepare(
        `UPDATE quotes SET version = ?, status = ?, title = ?, customer_name = ?, customer_email = ?, items = ?,
           discount_percent = ?, tax_percent = ?, deposit_percent = ?, subtotal_cents = ?, total_cents = ?,
           amount_due_cents = ?, notes = ?, valid_until = ?, sent_at = ?, accepted_at = ?, paid_at = ?, rev = rev + 1
         WHERE id = ? AND rev = ?`,
      )
      .bind(
        c.version, c.status, c.title, c.customer_name, c.customer_email, c.items, c.discount_percent, c.tax_percent,
        c.deposit_percent, c.subtotal_cents, c.total_cents, c.amount_due_cents, c.notes, c.valid_until, c.sent_at,
        c.accepted_at, c.paid_at, stored.quote.id, stored.rev,
      )
      .run();
    return result.meta.changes === 1;
  }

  async priceLookup(ownerId: string, query: string, limit: number): Promise<PriceStat[]> {
    const pattern = `%${query.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
    const { results } = await this.db
      .prepare(
        `WITH lines AS (
           SELECT json_extract(j.value, '$.description') AS description,
                  lower(trim(json_extract(j.value, '$.description'))) AS key,
                  json_extract(j.value, '$.unit') AS unit,
                  json_extract(j.value, '$.unitPrice') AS price,
                  q.created_at AS at
           FROM quotes q, json_each(q.items) j
           WHERE q.owner_id = ?1 AND json_extract(j.value, '$.description') LIKE ?2 ESCAPE '\\'
         ),
         ranked AS (
           SELECT *,
             row_number() OVER w AS rn,
             count(*) OVER (PARTITION BY key, unit) AS n,
             min(price) OVER (PARTITION BY key, unit) AS lo,
             max(price) OVER (PARTITION BY key, unit) AS hi
           FROM lines
           WINDOW w AS (PARTITION BY key, unit ORDER BY at DESC)
         )
         SELECT description, unit, price AS last, lo AS min, hi AS max, n AS count, at AS lastQuotedAt
         FROM ranked WHERE rn = 1 ORDER BY count DESC, lastQuotedAt DESC LIMIT ?3`,
      )
      .bind(ownerId, pattern, limit)
      .all<PriceStat>();
    return results;
  }
}
