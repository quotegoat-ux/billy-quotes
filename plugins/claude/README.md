# Billy Quotes for Claude

This plugin connects Claude to Billy Quotes and teaches it how to quote.

It contains:

- The `billy-quotes` connector, defined in `.mcp.json`.
- The `quoting` skill, which covers what to ask before quoting, looking up past prices, applying the user's pricing rules, and sending.
- `/quote`, which drafts a quote from a one-line request.
- `/follow-up`, which finds quotes with no reply and drafts nudges for the user to send.

## Install

In Claude Code or Cowork:

```
/plugin marketplace add quotegoat-ux/billy-quotes
/plugin install billy-quotes@billy-quotes
```

On claude.ai without plugins, add the connector by URL under Customize > Connectors and upload `skills/quoting` as a skill.

## Weekly follow-up

In Cowork, create a scheduled task that runs every Monday at 8am with the prompt `/billy-quotes:follow-up 7`. Claude drafts a follow-up for every quote that has had no reply for a week and lists accepted quotes that are still unpaid. It never sends anything on its own.
