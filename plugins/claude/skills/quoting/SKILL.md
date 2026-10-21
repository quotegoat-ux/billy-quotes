---
name: quoting
description: Use when the user wants to price something for a customer, draft, change, send or check a quote, or follow up on open quotes with the Billy Quotes tools.
---

# Quoting with Billy Quotes

Billy Quotes prices goods and services for any kind of business. The `billy-quotes` connector holds the quotes. This skill says how to use it well.

## Before you create a quote

Get these from the user, asking only for what is missing:

- Who the customer is. A name is enough; an email is optional.
- What is being priced, as line items. Each item has a description, a quantity, a unit and a unit price.
- Any deposit, discount or tax the user wants.

Pick the unit that matches how the business charges: `each` for goods, `hr` or `day` for time, `guest` for events, `kg` or `m` for materials. Default to `each`.

When the user gives no price for an item, call `price_lookup` with the item's description. Use the most recent price for the same unit and tell the user which past quote it came from. If nothing matches, ask. Never invent a price.

When the user shares a file such as a brief, an RFP, a spec sheet or a photo, read it, draft the line items from it, and show the user what you read before you create the quote.

## Business rules

Apply the rules in the user's pricing notes if they have given any, for example minimum order values, volume discounts, setup fees or payment terms. If a rule changes a quote, say which rule and what it changed. If the user has not given rules, do not make any up.

## Creating and revising

- Call `create_quote` once you have the customer and at least one priced line item.
- Change a quote with `revise_quote`. Send only the changes. Revising a sent quote puts it back into draft and gives it a new version, so tell the user they will need to send it again.
- The server computes every total. Report totals from the tool result, never from your own arithmetic.

## Sending

`send_quote` locks the quote and returns two links: the quote page and the payment link. It does not email the customer. Before you call it, confirm the customer name and total with the user. Afterwards, give the user both links and offer to write a short message they can send with them.

## Checking and following up

Use `quote_status` to answer "where is quote Q-1042" or "what is still open". For follow-ups, see the `/follow-up` command.

## Writing to customers

Write in the user's voice: short, plain and friendly. Lead with the total and what it covers. Mention the deposit and the date the quote is valid until. Do not add discounts, promises or deadlines the user did not give you.
