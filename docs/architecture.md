# Billy Quotes architecture

Billy Quotes is a quoting app for any business, goods or services. One MCP server serves both the ChatGPT app and the Claude connector. It runs as a Cloudflare Worker with a D1 database.

## Layout

| Path | Package | Owns |
| --- | --- | --- |
| `packages/core` | `@billy/core` | Quote types, money math, status transitions, revision ops, input schemas. Pure, no I/O. |
| `packages/quote-card` | `@billy/quote-card` | The MCP App quote card. Builds to one self-contained HTML file and exports it as a string. |
| `apps/worker` | `@billy/worker` | Cloudflare Worker: MCP endpoint, OAuth resource metadata, public quote page, payment redirect, Stripe webhook, D1 migrations. |
| `plugins/claude` | n/a | Claude plugin: connector config, quoting skill, `/quote` and `/follow-up` commands. |

## Data shape

Money is integer cents everywhere (`Cents` brand). The server computes every total; clients never send totals.

```ts
type QuoteStatus = "draft" | "sent" | "accepted" | "paid" | "declined";

interface LineItem {
  id: string;            // stable within a quote, used by revise ops
  description: string;
  quantity: number;      // > 0, up to 3 decimals
  unit: string;          // "each", "hr", "kg", "guest"; lowercase, default "each"
  unitPrice: Cents;      // >= 0
}

interface Quote {
  id: string;
  ownerId: string;       // OAuth subject
  number: string;        // "Q-1001", sequential per owner
  version: number;       // bumps when a sent quote is revised
  status: QuoteStatus;
  title: string;
  customer: { name: string; email?: string };
  currency: "USD";
  items: LineItem[];
  discountPercent: number;   // 0..100
  taxPercent: number;        // 0..100
  depositPercent: number;    // 0..100; 0 means pay in full
  notes?: string;
  validUntil: string;        // ISO date
  publicToken: string;       // unguessable, used in /q/{token} and /pay/{token}
  source?: { name: string; url?: string }; // file the quote was drafted from
  createdAt: string; sentAt?: string; acceptedAt?: string; paidAt?: string;
}

interface Totals { subtotal: Cents; discount: Cents; tax: Cents; total: Cents; amountDue: Cents }
```

Status transitions are one table, `TRANSITIONS[status][event] -> status`:

| From | Event | To |
| --- | --- | --- |
| draft | send | sent |
| draft, sent | revise | draft (from sent: version + 1) |
| sent | accept | accepted |
| sent | decline | declined |
| sent, accepted | pay | paid |

Anything else is a typed error the tool reports in plain words. `expired` is derived from `validUntil`, never stored.

## Tools

Every tool returns a short text summary in `content` and the quote in `structuredContent`, so it works as a plain connector with text replies. The four quote tools set `_meta.ui.resourceUri = "ui://billy/quote-card.html"`.

| Tool | Does | Annotations |
| --- | --- | --- |
| `create_quote` | Customer, title, items, optional percents, valid days, optional source file. ChatGPT `openai/fileParams: ["source_file"]`. | write |
| `revise_quote` | Ops on one quote: add, update, remove items; change customer, title, notes, percents, valid days. | write, idempotent per op set |
| `quote_status` | One quote by id or number, or a list filtered by status and age (`open_older_than_days`). | readOnly |
| `send_quote` | Draft to sent. Returns the public link and the pay link. Does not email anyone. | write |
| `price_lookup` | Searches line items this owner quoted before; returns last, min, max and count per unit. | readOnly |

## Auth

The Worker is an OAuth 2.1 resource server. WorkOS AuthKit is the authorization server and handles dynamic client registration for ChatGPT and Claude. The Worker serves `/.well-known/oauth-protected-resource`, verifies Bearer JWTs against the AuthKit JWKS, and answers 401 with `WWW-Authenticate: Bearer resource_metadata=...`. The token subject is `ownerId`. `DEV_AUTH_TOKEN`, set only in `.dev.vars`, maps to a fixed dev user for local testing.

## Money

`/q/{token}` is a public page: quote, Accept button, Pay button. `/pay/{token}` is the stable payment link used everywhere. On each visit it creates a Stripe Checkout Session for `amountDue` and redirects. `/stripe/webhook` verifies the signature and applies `pay`. Without `STRIPE_SECRET_KEY`, the pay link shows a "payments not set up" page. ChatGPT Instant Checkout is a private beta. See `docs/instant-checkout.md`.

## Host adapters

The card uses the MCP Apps standard (`@modelcontextprotocol/ext-apps`) for both hosts. Host-specific behavior is feature-detected:

- Fullscreen editor: shown when the host reports `displayMode: "fullscreen"`. The Edit action calls `requestDisplayMode`. Hosts without fullscreen get a follow-up message instead.
- `window.openai.setOpenInAppUrl` points ChatGPT's "Open in app" at `/q/{token}`.
- Claude gets the plugin in `plugins/claude`.
