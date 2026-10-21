/**
 * Renders the built card inside a fake MCP Apps host in Chromium and
 * screenshots it inline and fullscreen. Tool calls from the card are answered
 * by @billy/core, the same functions the worker runs.
 *
 *   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm --filter @billy/quote-card shots
 */
import {
  createQuote,
  createQuoteInput,
  describeError,
  describeQuote,
  reviseQuoteInput,
  revise,
  toNewQuote,
  toQuoteView,
  toReviseOp,
  transition,
  type Quote,
  type QuoteEvent,
} from "@billy/core";
import { strict as assert } from "node:assert";
import { copyFile, mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Frame, type Page } from "playwright";

const OUT = process.env.SHOTS_DIR ?? "/tmp/claude-0/shots";
const NOW = new Date();
const BASE = "https://quotes.example.com";

let quote: Quote = createQuote(
  toNewQuote(
    createQuoteInput.parse({
      title: "Kitchen backsplash and floor tile",
      customer: { name: "Rosa Delgado", email: "rosa@example.com" },
      items: [
        { description: "Porcelain tile 12x24", quantity: 86.5, unit: "sq ft", unit_price: 4.79 },
        { description: "Thinset mortar, 50 lb bag", quantity: 3, unit_price: 32.98 },
        { description: "Tile installation labor", quantity: 14.5, unit: "hr", unit_price: 65 },
        { description: "Grout, unsanded", quantity: 2, unit_price: 18.47 },
        { description: "Schluter edge trim", quantity: 24, unit: "ft", unit_price: 3.5 },
        { description: "Demo and haul-away of old tile", quantity: 1, unit_price: 280 },
        { description: "Floor leveling compound", quantity: 2, unit: "bag", unit_price: 41.2 },
      ],
      discount_percent: 10,
      tax_percent: 8.25,
      deposit_percent: 50,
      notes: "Price assumes subfloor is sound.",
    }),
  ),
  { id: "q_demo", ownerId: "dev", seq: 12, publicToken: "pt_demo", now: NOW },
);

const resultFor = (q: Quote) => {
  const view = toQuoteView(q, { baseUrl: BASE, now: NOW });
  return { content: [{ type: "text", text: describeQuote(view) }], structuredContent: { quote: view } };
};

function step(q: Quote, event: QuoteEvent): Quote {
  const result = transition(q, event, NOW);
  if (!result.ok) throw new Error(describeError(result.error));
  return result.value;
}

const toolCalls: Array<{ name: string; arguments: Record<string, unknown> }> = [];

function callTool(params: { name: string; arguments: Record<string, unknown> }) {
  toolCalls.push(params);
  if (params.name === "send_quote") {
    quote = step(quote, "send");
    return resultFor(quote);
  }
  if (params.name === "revise_quote") {
    const input = reviseQuoteInput.parse(params.arguments);
    const revised = revise(quote, input.ops.map(toReviseOp), NOW);
    if (!revised.ok) return { isError: true, content: [{ type: "text", text: describeError(revised.error) }] };
    quote = revised.value;
    return resultFor(quote);
  }
  return { isError: true, content: [{ type: "text", text: `unexpected tool ${params.name}` }] };
}

async function openHost(page: Page, dir: string, theme: "light" | "dark"): Promise<Frame> {
  page.on("console", (m) => process.env.DEBUG && console.log(`[${m.type()}] ${m.text()}`));
  page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
  await page.exposeFunction("__callToolNode", callTool);
  // Init scripts go in as strings: tsx wraps functions with a __name helper that doesn't exist in the page.
  await page.addInitScript(
    `window.__setup = ${JSON.stringify({ theme, toolResult: resultFor(quote) })};
     window.__callTool = (p) => window.__callToolNode(p);`,
  );
  await page.goto(`file://${join(dir, "host.html")}`);
  const frame = page.frameLocator("#frame");
  await frame.locator(".card, .editor").first().waitFor();
  const handle = page.frames().find((f) => f.url().endsWith("card.html"));
  assert(handle, "card iframe loaded");
  return handle;
}

async function shot(page: Page, name: string): Promise<string> {
  await page.waitForTimeout(150);
  const path = join(OUT, `${name}.png`);
  await page.screenshot({ path, fullPage: true });
  return path;
}

async function main(): Promise<void> {
  await mkdir(OUT, { recursive: true });
  const dir = await mkdtemp(join(tmpdir(), "quote-card-"));
  await copyFile(new URL("../dist/quote-card.html", import.meta.url), join(dir, "card.html"));
  await copyFile(new URL("./fake-host.html", import.meta.url), join(dir, "host.html"));

  const browser = await chromium.launch();
  const shots: string[] = [];
  const inline = { viewport: { width: 780, height: 900 } };

  {
    const page = await browser.newPage(inline);
    const card = await openHost(page, dir, "light");
    assert.equal(await card.locator(".item").count(), 5, "inline shows at most 5 lines");
    assert.equal(await card.locator(".more").textContent(), "+2 more items");
    assert.deepEqual(await card.locator(".actions button").allTextContents(), ["Send quote", "Edit"]);
    assert.equal(await card.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 1), true, "host sized the frame to the card");
    shots.push(await shot(page, "inline-draft-light"));

    await card.getByRole("button", { name: "Send quote" }).click();
    await card.getByRole("button", { name: "Copy link" }).waitFor();
    assert.deepEqual(await card.locator(".actions button").allTextContents(), ["Copy link", "Open"]);
    const log = (await page.evaluate("window.__log")) as Array<{ method?: string }>;
    assert(log.some((m) => m.method === "ui/update-model-context"), "model told about the send");
    shots.push(await shot(page, "inline-sent-light"));
    await page.close();
  }

  quote = createQuote(toNewQuote(createQuoteInput.parse({ ...quoteInputFrom(quote), valid_days: 30 })), {
    id: "q_demo2", ownerId: "dev", seq: 13, publicToken: "pt_demo2", now: NOW,
  });
  {
    const page = await browser.newPage(inline);
    const card = await openHost(page, dir, "dark");
    shots.push(await shot(page, "inline-draft-dark"));

    await card.getByRole("button", { name: "Edit" }).click();
    await card.locator(".editor").waitFor();
    await page.setViewportSize({ width: 1024, height: 760 });
    shots.push(await shot(page, "fullscreen-editor-dark"));

    await card.getByLabel("Line 3 quantity").fill("16");
    await card.getByRole("button", { name: "Add line" }).click();
    await card.getByLabel("Line 8 description").fill("Sealer application");
    await card.getByLabel("Line 8 unit price in dollars").fill("95");
    await card.getByLabel("Deposit %").fill("30");
    await card.getByRole("button", { name: "Save" }).click();
    await card.getByText(/Saved Q-1013 v1/).waitFor();
    const revise = toolCalls.at(-1);
    assert.equal(revise?.name, "revise_quote");
    assert.deepEqual(
      (revise?.arguments.ops as Array<{ op: string }>).map((o) => o.op),
      ["update_item", "add_item", "set_deposit_percent"],
      "editor sends only the changed fields",
    );
    assert.equal(quote.items.length, 8);
    const padding = await card.evaluate(() => getComputedStyle(document.querySelector(".editor")!).paddingBottom);
    assert.equal(padding, "120px", "editor leaves room for an overlaid composer");
    await card.locator(".actions").scrollIntoViewIfNeeded();
    shots.push(await shot(page, "fullscreen-saved-dark"));

    await card.getByRole("button", { name: "Done" }).click();
    await card.locator(".card").waitFor();
    await page.setViewportSize(inline.viewport);
    shots.push(await shot(page, "inline-after-edit-dark"));
    await page.close();
  }

  quote = step(step(quote, "send"), "accept");
  {
    const page = await browser.newPage(inline);
    const card = await openHost(page, dir, "light");
    assert.deepEqual(await card.locator(".actions button").allTextContents(), ["Copy pay link", "Open"]);
    shots.push(await shot(page, "inline-accepted-light"));
    await page.close();
  }

  {
    const page = await browser.newPage({ viewport: { width: 700, height: 900 } });
    const view = resultFor(quote).structuredContent;
    const opened: string[] = [];
    await page.exposeFunction("__opened", (href: string) => opened.push(href));
    await page.addInitScript(
      `window.openai = { toolOutput: ${JSON.stringify(view)}, theme: "dark", displayMode: "inline", locale: "en-US",
         setOpenInAppUrl: ({ href }) => window.__opened(href) };`,
    );
    await page.goto(`file://${join(dir, "card.html")}`);
    await page.locator(".card").waitFor();
    await page.emulateMedia({ colorScheme: "light" });
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "dark", "legacy theme applied");
    assert.deepEqual(opened, [`${BASE}/q/${quote.publicToken}`], "setOpenInAppUrl points at the public page");
    shots.push(await shot(page, "chatgpt-legacy-toolOutput-dark"));
    await page.close();
  }

  await browser.close();
  console.log(`tool calls: ${toolCalls.map((c) => c.name).join(", ")}`);
  console.log(shots.join("\n"));
}

function quoteInputFrom(q: Quote) {
  return {
    title: q.title,
    customer: q.customer,
    items: q.items.map((it) => ({ description: it.description, quantity: it.quantity, unit: it.unit, unit_price: it.unitPrice / 100 })),
    discount_percent: q.discountPercent,
    tax_percent: q.taxPercent,
    deposit_percent: q.depositPercent,
  };
}

await main();
