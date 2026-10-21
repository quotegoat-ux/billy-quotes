-- One row per quote. Line items live in `items` as a JSON array of
-- {id, description, quantity, unit, unitPrice}, unitPrice in integer cents.
CREATE TABLE quotes (
  id               TEXT PRIMARY KEY,
  owner_id         TEXT NOT NULL,
  seq              INTEGER NOT NULL CHECK (seq > 0),
  version          INTEGER NOT NULL CHECK (version > 0),
  status           TEXT NOT NULL CHECK (status IN ('draft', 'sent', 'accepted', 'paid', 'declined')),
  title            TEXT NOT NULL CHECK (length(title) > 0),
  customer_name    TEXT NOT NULL CHECK (length(customer_name) > 0),
  customer_email   TEXT,
  currency         TEXT NOT NULL CHECK (currency = 'USD'),
  items            TEXT NOT NULL CHECK (json_valid(items) AND json_type(items) = 'array'),
  discount_percent REAL NOT NULL CHECK (discount_percent BETWEEN 0 AND 100),
  tax_percent      REAL NOT NULL CHECK (tax_percent BETWEEN 0 AND 100),
  deposit_percent  REAL NOT NULL CHECK (deposit_percent BETWEEN 0 AND 100),
  -- Denormalized from the items so reports and the database itself can see money; written by the server only.
  subtotal_cents   INTEGER NOT NULL CHECK (subtotal_cents >= 0),
  total_cents      INTEGER NOT NULL CHECK (total_cents >= 0),
  amount_due_cents INTEGER NOT NULL CHECK (amount_due_cents >= 0 AND amount_due_cents <= total_cents),
  notes            TEXT,
  valid_until      TEXT NOT NULL CHECK (valid_until GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  public_token     TEXT NOT NULL UNIQUE,
  source_name      TEXT,
  source_url       TEXT,
  created_at       TEXT NOT NULL,
  sent_at          TEXT,
  accepted_at      TEXT,
  paid_at          TEXT,
  -- Row revision for compare-and-set writes; not the customer-facing version.
  rev              INTEGER NOT NULL DEFAULT 1,
  UNIQUE (owner_id, seq),
  CHECK (status = 'draft' OR sent_at IS NOT NULL),
  CHECK (status <> 'accepted' OR accepted_at IS NOT NULL),
  CHECK (status <> 'paid' OR paid_at IS NOT NULL)
);

CREATE INDEX quotes_owner_status_sent ON quotes (owner_id, status, sent_at);

CREATE TRIGGER quotes_items_valid_insert BEFORE INSERT ON quotes
WHEN EXISTS (
  SELECT 1 FROM json_each(NEW.items)
  WHERE json_type(value, '$.unitPrice') IS NOT 'integer'
     OR json_extract(value, '$.unitPrice') < 0
     OR coalesce(json_type(value, '$.quantity'), '') NOT IN ('integer', 'real')
     OR json_extract(value, '$.quantity') <= 0
     OR json_type(value, '$.id') IS NOT 'text'
)
BEGIN
  SELECT RAISE(ABORT, 'each line item needs an id, quantity > 0 and integer unitPrice >= 0');
END;

CREATE TRIGGER quotes_items_valid_update BEFORE UPDATE OF items ON quotes
WHEN EXISTS (
  SELECT 1 FROM json_each(NEW.items)
  WHERE json_type(value, '$.unitPrice') IS NOT 'integer'
     OR json_extract(value, '$.unitPrice') < 0
     OR coalesce(json_type(value, '$.quantity'), '') NOT IN ('integer', 'real')
     OR json_extract(value, '$.quantity') <= 0
     OR json_type(value, '$.id') IS NOT 'text'
)
BEGIN
  SELECT RAISE(ABORT, 'each line item needs an id, quantity > 0 and integer unitPrice >= 0');
END;
