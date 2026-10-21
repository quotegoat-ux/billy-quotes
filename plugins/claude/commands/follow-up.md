---
description: Find open Billy Quotes quotes that need a nudge and draft follow-ups
argument-hint: "[days without a reply, default 7]"
---

Follow up on open quotes.

1. Call `quote_status` with `status: "sent"` and `open_older_than_days` set to $ARGUMENTS, or 7 if no number was given. Also check `status: "accepted"` for quotes that were accepted but not paid.
2. For each quote, draft a two or three sentence follow-up in the user's voice that names the quote, the total and the link. For accepted but unpaid quotes, include the payment link.
3. Show the user a table of quote number, customer, total, status and days since sent, then the drafts.
4. End with a one-line summary: quotes sent, accepted and paid in the last 7 days.

Do not send anything. The user sends the follow-ups.
