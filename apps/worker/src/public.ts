import { describeError, formatUSD, isPayable, toQuoteView, transition, type QuoteView } from "@billy/core";
import { baseUrl } from "./auth.ts";
import type { Env } from "./env.ts";
import type { QuoteStore } from "./store.ts";

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (value: string | number): string => String(value).replace(/[&<>"']/g, (ch) => ESCAPES[ch] ?? ch);

const STYLE = `
:root { color-scheme: light dark; --bg:#fff; --text:#1a1d21; --muted:#59626e; --border:#dde1e6; --primary:#1f5fd1; --on-primary:#fff; --danger:#b42318; --ok:#10612f; }
@media (prefers-color-scheme: dark) { :root { --bg:#17181b; --text:#eceef1; --muted:#a8afb9; --border:#33363c; --primary:#8ab0f7; --on-primary:#0a1630; --danger:#ffb4ab; --ok:#96e2b5; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 16px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
main { max-width: 720px; margin: 0 auto; padding: 32px 16px 48px; }
.muted { color: var(--muted); }
h1 { font-size: 24px; margin: 4px 0; }
table { width: 100%; border-collapse: collapse; margin: 24px 0 8px; }
th, td { text-align: left; padding: 10px 8px 10px 0; border-bottom: 1px solid var(--border); vertical-align: top; }
th { font-size: 13px; color: var(--muted); font-weight: 600; }
.num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
.totals { margin-left: auto; max-width: 320px; }
.totals div { display: flex; justify-content: space-between; padding: 2px 0; font-variant-numeric: tabular-nums; }
.total { font-weight: 700; font-size: 18px; }
.banner { padding: 12px 14px; border: 1px solid var(--border); border-radius: 10px; margin: 20px 0; }
.banner.ok { color: var(--ok); } .banner.bad { color: var(--danger); }
.actions { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 24px; }
form { margin: 0; }
button { font: inherit; font-weight: 600; min-height: 44px; padding: 0 18px; border-radius: 10px; cursor: pointer; border: 1px solid var(--border); background: transparent; color: var(--text); }
button.primary { background: var(--primary); color: var(--on-primary); border-color: transparent; }
`;

export function page(title: string, body: string, status = 200): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title><style>${STYLE}</style></head><body><main>${body}</main></body></html>`;
  return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

export function notFound(): Response {
  return page("Quote not found", `<h1>Quote not found</h1><p class="muted">This link doesn't match a quote that has been sent.</p>`, 404);
}

function banner(view: QuoteView, payable: boolean): string {
  const day = (iso: string | undefined) => (iso ? esc(iso.slice(0, 10)) : "");
  switch (view.status) {
    case "paid":
      return `<p class="banner ok">Paid ${day(view.paidAt)}. Thank you.</p>`;
    case "declined":
      return `<p class="banner bad">This quote was declined.</p>`;
    case "accepted":
      return `<p class="banner ok">Accepted ${day(view.acceptedAt)}.${payable ? " Payment is due below." : ""}</p>`;
    case "sent":
      return view.expired ? `<p class="banner bad">This quote expired on ${esc(view.validUntil)}. Ask for an updated quote.</p>` : "";
    case "draft":
      return "";
    default: {
      const exhaustive: never = view.status;
      return exhaustive;
    }
  }
}

export function renderQuotePage(view: QuoteView, opts: { now: Date; paymentsEnabled: boolean; notice?: string }): Response {
  const payable = isPayable(view, opts.now);
  const t = view.totals;
  const rows = view.items
    .map(
      (it) =>
        `<tr><td>${esc(it.description)}<div class="muted">${esc(it.quantity)} ${esc(it.unit)} × ${formatUSD(it.unitPrice)}</div></td><td class="num">${formatUSD(it.amount)}</td></tr>`,
    )
    .join("");
  const totals = [
    `<div><span>Subtotal</span><span>${formatUSD(t.subtotal)}</span></div>`,
    t.discount ? `<div><span>Discount (${esc(view.discountPercent)}%)</span><span>−${formatUSD(t.discount)}</span></div>` : "",
    view.taxPercent ? `<div><span>Tax (${esc(view.taxPercent)}%)</span><span>${formatUSD(t.tax)}</span></div>` : "",
    `<div class="total"><span>Total</span><span>${formatUSD(t.total)}</span></div>`,
    view.depositPercent ? `<div><span>Deposit due (${esc(view.depositPercent)}%)</span><span>${formatUSD(t.amountDue)}</span></div>` : "",
  ].join("");
  const canRespond = view.status === "sent" && !view.expired;
  const token = esc(view.publicToken);
  const payLabel = view.depositPercent ? `Pay deposit ${formatUSD(t.amountDue)}` : `Pay ${formatUSD(t.amountDue)}`;
  const actions = [
    canRespond ? `<form method="post" action="/q/${token}/accept"><button class="primary" type="submit">Accept quote</button></form>` : "",
    payable && opts.paymentsEnabled ? `<form method="post" action="/pay/${token}"><button class="${canRespond ? "" : "primary"}" type="submit">${payLabel}</button></form>` : "",
    canRespond ? `<form method="post" action="/q/${token}/decline"><button type="submit">Decline</button></form>` : "",
  ].join("");
  const body = `
    <p class="muted">Quote ${esc(view.number)}${view.version > 1 ? ` · version ${esc(view.version)}` : ""}</p>
    <h1>${esc(view.title)}</h1>
    <p class="muted">Prepared for ${esc(view.customer.name)} · Valid until ${esc(view.validUntil)}</p>
    ${opts.notice ? `<p class="banner" role="status">${esc(opts.notice)}</p>` : ""}
    ${banner(view, payable)}
    <table><thead><tr><th>Item</th><th class="num">Amount</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="totals">${totals}</div>
    ${view.notes ? `<p>${esc(view.notes)}</p>` : ""}
    ${actions ? `<div class="actions">${actions}</div>` : ""}`;
  return page(`Quote ${view.number}: ${view.title}`, body);
}

/** Cross-site form posts can't accept or decline someone's quote. */
export function sameOrigin(request: Request, env: Env): boolean {
  const origin = request.headers.get("Origin");
  return origin === null || origin === new URL(baseUrl(env)).origin;
}

export async function showQuote(token: string, env: Env, store: QuoteStore, now: Date, notice?: string): Promise<Response> {
  const stored = await store.getByToken(token);
  if (!stored || stored.quote.status === "draft") return notFound();
  const view = toQuoteView(stored.quote, { baseUrl: baseUrl(env), now });
  return renderQuotePage(view, { now, paymentsEnabled: Boolean(env.STRIPE_SECRET_KEY), ...(notice ? { notice } : {}) });
}

export async function respond(token: string, event: "accept" | "decline", env: Env, store: QuoteStore, now: Date): Promise<Response> {
  const stored = await store.getByToken(token);
  if (!stored || stored.quote.status === "draft") return notFound();
  const next = transition(stored.quote, event, now);
  if (!next.ok) {
    const view = toQuoteView(stored.quote, { baseUrl: baseUrl(env), now });
    const response = renderQuotePage(view, { now, paymentsEnabled: Boolean(env.STRIPE_SECRET_KEY), notice: describeError(next.error) });
    return new Response(response.body, { status: 409, headers: response.headers });
  }
  if (!(await store.update(stored, next.value))) return showQuote(token, env, store, now, "This quote just changed. Please review it again.");
  return Response.redirect(`${baseUrl(env)}/q/${encodeURIComponent(token)}`, 303);
}

