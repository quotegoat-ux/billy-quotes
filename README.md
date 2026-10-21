# Billy Quotes

Billy Quotes is a quoting app for any business, for goods and for services. This repo holds the MCP server that powers the Billy Quotes ChatGPT app and Claude connector, the quote card both hosts render, and the Claude plugin.

| Path | What it is |
| --- | --- |
| `packages/core` | Quote rules: money in cents, totals, status changes, revisions. |
| `packages/quote-card` | The MCP App quote card, built to one HTML file. |
| `apps/worker` | The Cloudflare Worker: MCP endpoint, OAuth, public quote page, payment links. |
| `plugins/claude` | The Claude plugin: connector, quoting skill, `/quote`, `/follow-up`. |

## Develop

```sh
pnpm install
cp apps/worker/.dev.vars.example apps/worker/.dev.vars
pnpm db:migrate:local
pnpm dev                     # Worker on http://localhost:8787
pnpm test && pnpm typecheck
DEV_AUTH_TOKEN=... STRIPE_WEBHOOK_SECRET=... pnpm --filter @billy/worker smoke
```

## Read more

- [Architecture](docs/architecture.md)
- [Deploying to Cloudflare](docs/deploy.md)
- [ChatGPT Instant Checkout](docs/instant-checkout.md)
- [Claude plugin](plugins/claude/README.md)
