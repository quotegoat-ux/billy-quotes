# Deploying to Cloudflare

The MCP server is one Cloudflare Worker with one D1 database. There are two environments: `stage` and `production`. Each has its own Worker and its own database. Both live on the Quote Goat account's `quote-goat.workers.dev` subdomain and are separate from the existing `billy-quotes-stage` Worker.

| Environment | Worker | D1 database |
| --- | --- | --- |
| stage | `billy-quotes-mcp-stage` | `billy-quotes-db-stage` |
| production | `billy-quotes-mcp` | `billy-quotes-db` |

## First-time setup

The `CLOUDFLARE_API_TOKEN` used to deploy needs Workers Scripts Edit and D1 Edit on the account.


1. Create the database: `pnpm --filter @billy/worker exec wrangler d1 create billy-quotes-db-stage`. Put the returned `database_id` into `apps/worker/wrangler.jsonc` under `env.stage`.
2. Apply migrations: `pnpm --filter @billy/worker db:migrate:stage`.
3. Set secrets with `wrangler secret put <NAME> --env stage`: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`. Never set `DEV_AUTH_TOKEN` outside local development.
4. Stage uses the Billy Quotes WorkOS staging AuthKit domain, `loyal-bear-08-staging.authkit.app`. In that WorkOS environment, turn on dynamic client registration and add the Worker's `/mcp` URL as an OAuth resource, so ChatGPT and Claude can register themselves as OAuth clients. Sign-up is off there, so only existing users can sign in.
5. Deploy: `pnpm deploy:stage`.
6. In Stripe, add a webhook endpoint at `https://<worker-url>/stripe/webhook` for `checkout.session.completed`.

## Connecting the hosts

- **Claude.** Add a custom connector with the Worker's `/mcp` URL, or install the plugin from this repo (`/plugin marketplace add quotegoat-ux/billy-quotes`). Update the URL in `plugins/claude/.mcp.json` when the production URL changes.
- **ChatGPT.** In developer mode, create an app with the Worker's `/mcp` URL. For directory submission, set the widget domain to the production Worker's origin.
