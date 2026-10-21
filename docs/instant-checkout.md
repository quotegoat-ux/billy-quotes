# ChatGPT Instant Checkout

Instant Checkout lets a ChatGPT app hand a cart to ChatGPT's own payment sheet. As of October 2026, OpenAI lists it as a private beta for select merchants, so Billy Quotes ships with payment links and treats Instant Checkout as an upgrade once approved.

## What Billy Quotes uses today

Every quote has a stable payment link, `/pay/{token}`. It creates a Stripe Checkout Session for the amount due and redirects. The link works in ChatGPT, in Claude, in email and in a text message.

## How to apply

1. Apply through OpenAI's Agentic Commerce / Instant Checkout program from the [Apps SDK monetization docs](https://developers.openai.com/apps-sdk/build/monetization).
2. Use Stripe as the payment service provider, since the Worker already talks to Stripe.
3. Submit the ChatGPT app for review with the payment link flow in place. The app must pass review without Instant Checkout.

## What changes after approval

- The quote card calls `window.openai.requestCheckout(session)` from the pay action when that function exists, instead of opening `/pay/{token}`.
- The Worker adds a `complete_checkout` tool that receives the payment token from ChatGPT, charges it through Stripe, and applies the `pay` transition to the quote.
- The webhook path stays, so payments made through the link still mark quotes paid.

Neither change is built yet. The request and response shapes come from the beta documentation, which is only available after approval.
