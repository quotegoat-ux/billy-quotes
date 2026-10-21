export interface Env {
  DB: D1Database;
  /** Origin the public quote and pay links use, e.g. https://quotes.example.com */
  PUBLIC_BASE_URL: string;
  /** WorkOS AuthKit domain, e.g. your-app.authkit.app */
  AUTHKIT_DOMAIN: string;
  /** Optional dedicated sandbox origin for ChatGPT (`openai/widgetDomain`). */
  OPENAI_WIDGET_DOMAIN?: string;
  /** Optional dedicated sandbox origin for MCP Apps hosts (`_meta.ui.domain`). */
  MCP_UI_DOMAIN?: string;
  DEV_AUTH_TOKEN?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
}
