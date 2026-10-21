/**
 * Renders the built card inside a fake MCP Apps host in Chromium, drives it the
 * way a user would, and screenshots it. Tool calls from the card are answered
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
  toListEntry,
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
import { chromium, type Browser, type Frame, type Page } from "playwright";

const OUT = process.env.SHOTS_DIR ?? "/tmp/claude-0/shots3";
const NOW = new Date();
const BASE = "https://quotes.example.com";
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 820 };

const demoInput = createQuoteInput.parse({
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
});

let seq = 12;
const fresh = (): Quote =>
  createQuote(toNewQuote(demoInput), { id: `q_demo${seq}`, ownerId: "dev", seq: seq++, publicToken: `pt_demo${seq}`, now: NOW });

let quote = fresh();

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
const reviseCalls = () => toolCalls.filter((c) => c.name === "revise_quote").length;

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

async function openHost(browser: Browser, dir: string, theme: "light" | "dark", viewport = PHONE): Promise<{ page: Page; card: Frame }> {
  const page = await browser.newPage({ viewport, colorScheme: theme });
  page.on("console", (m) => process.env.DEBUG && console.log(`[${m.type()}] ${m.text()}`));
  page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
  await page.exposeFunction("__callToolNode", callTool);
  // Init scripts go in as strings: tsx wraps functions with a __name helper that doesn't exist in the page.
  await page.addInitScript(
    `window.__setup = ${JSON.stringify({ theme, toolResult: resultFor(quote) })};
     window.__callTool = (p) => window.__callToolNode(p);`,
  );
  await page.goto(`file://${join(dir, "host.html")}`);
  await page.frameLocator("#frame").locator("article").first().waitFor();
  const card = page.frames().find((f) => f.url().endsWith("card.html"));
  assert(card, "card iframe loaded");
  return { page, card };
}

async function shot(page: Page, name: string): Promise<string> {
  await page.waitForTimeout(200);
  const path = join(OUT, `${name}.png`);
  await page.screenshot({ path });
  return path;
}

const actionLabels = (card: Frame) => card.locator("article > div:last-child button").allTextContents();

async function inlineLabels(browser: Browser, dir: string, q: Quote, expected: string[]): Promise<void> {
  quote = q;
  const { page, card } = await openHost(browser, dir, "light");
  assert.deepEqual(await actionLabels(card), expected, `inline actions for ${q.status}`);
  await page.close();
}

// Plain strings, not functions: tsx would wrap named helpers in a __name call the page doesn't have.
const CONTRAST_FAILURES = `(() => {
  const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  const paint = (layers) => {
    ctx.clearRect(0, 0, 1, 1);
    for (const c of layers) { ctx.fillStyle = c; ctx.fillRect(0, 0, 1, 1); }
    return [...ctx.getImageData(0, 0, 1, 1).data];
  };
  const lum = ([r, g, b]) => [r, g, b].map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
  const failures = [];
  for (const el of document.querySelectorAll("body *")) {
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    const rect = el.getBoundingClientRect();
    if (!own || rect.width <= 1 || el.closest("button:disabled, [aria-hidden=true], dialog:not([open])") || !el.checkVisibility()) continue;
    const backgrounds = [];
    for (let a = el; a; a = a.parentElement) {
      const before = getComputedStyle(a, "::before");
      const fills = [getComputedStyle(a).backgroundColor, before.content !== "none" && before.opacity !== "0" ? before.backgroundColor : "transparent"];
      for (const bg of fills.reverse()) if (paint([bg])[3] > 0) backgrounds.unshift(bg);
      if (fills.some((bg) => paint([bg])[3] === 255)) break;
    }
    const style = getComputedStyle(el);
    const bg = paint(["#fff", ...backgrounds]);
    const fg = paint(["#fff", ...backgrounds, style.color]);
    const [hi, lo] = [lum(fg), lum(bg)].sort((x, y) => y - x);
    const ratio = (hi + 0.05) / (lo + 0.05);
    const size = parseFloat(style.fontSize);
    const large = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700);
    if (ratio < (large ? 3 : 4.5)) failures.push(el.textContent.trim().slice(0, 30) + " " + ratio.toFixed(2));
  }
  return failures;
})()`;

const FOCUS_RING = `(() => {
  const el = document.activeElement;
  if (el === document.body) return { name: "outside the card", shown: true, obscured: false };
  const ring = (s) => (s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0) || s.boxShadow !== "none";
  const shown = el.matches(":focus-visible") && (ring(getComputedStyle(el)) || ring(getComputedStyle(el, "::after")) || !!el.closest("[data-focused=true]"));
  const bar = document.querySelector("footer");
  const obscured = !!bar && !bar.contains(el) && el.getBoundingClientRect().bottom > bar.getBoundingClientRect().top;
  return { name: el.getAttribute("aria-label") || el.textContent.trim().slice(0, 20) || el.tagName, shown, obscured };
})()`;

async function assertContrast(card: Frame, where: string): Promise<void> {
  await card.evaluate("Promise.all(document.getAnimations().map((a) => a.finished))");
  assert.deepEqual(await card.evaluate(CONTRAST_FAILURES), [], `text meets AA contrast (${where})`);
}

async function assertFocusVisible(page: Page, card: Frame, tabs: number): Promise<void> {
  await card.locator("body").evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const missing: string[] = [];
  const hidden: string[] = [];
  for (let i = 0; i < tabs; i++) {
    await page.keyboard.press("Tab");
    const focus = (await card.evaluate(FOCUS_RING)) as { name: string; shown: boolean; obscured: boolean };
    if (!focus.shown) missing.push(focus.name);
    if (focus.obscured) hidden.push(focus.name);
  }
  assert.deepEqual(missing, [], "every keyboard stop shows a focus indicator");
  assert.deepEqual(hidden, [], "no focused control hides behind the bottom bar");
}

async function assertNoHorizontalOverflow(card: Frame, where: string): Promise<void> {
  const overflow = await card.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const out = [...document.querySelectorAll<HTMLElement>("body *")]
      .filter((el) => el.getClientRects().length > 0 && el.getBoundingClientRect().right > width + 0.5)
      .map((el) => `${el.tagName.toLowerCase()}.${el.className}`.slice(0, 80));
    return { scroll: document.documentElement.scrollWidth - width, out };
  });
  assert.deepEqual(overflow, { scroll: 0, out: [] }, `nothing overflows horizontally (${where})`);
}

async function main(): Promise<void> {
  await mkdir(OUT, { recursive: true });
  const dir = await mkdtemp(join(tmpdir(), "quote-card-"));
  await copyFile(new URL("../dist/quote-card.html", import.meta.url), join(dir, "card.html"));
  await copyFile(new URL("./fake-host.html", import.meta.url), join(dir, "host.html"));

  const browser = await chromium.launch();
  const shots: string[] = [];

  {
    const { page, card } = await openHost(browser, dir, "light");
    assert.equal(await card.locator("article li").count(), 6, "inline shows 5 lines and a more row");
    assert.equal(await card.locator("article li").last().textContent(), "+2 more items");
    assert.equal(await card.getByText("Draft", { exact: true }).count(), 1, "status badge");
    assert.deepEqual(await actionLabels(card), ["Send quote", "Edit"]);
    assert.equal(await card.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 1), true, "host sized the frame to the card");
    await assertNoHorizontalOverflow(card, "inline at 390");
    await assertContrast(card, "inline light");
    shots.push(await shot(page, "inline-draft-light"));

    await card.getByRole("button", { name: "Send quote" }).click();
    await card.getByRole("button", { name: "Copy link" }).waitFor();
    assert.deepEqual(await actionLabels(card), ["Copy link", "Open"]);
    const log = (await page.evaluate("window.__log")) as Array<{ method?: string }>;
    assert(log.some((m) => m.method === "ui/update-model-context"), "model told about the send");
    await page.close();
  }
  const sent = quote;
  await inlineLabels(browser, dir, step(sent, "accept"), ["Copy pay link", "Open"]);
  await inlineLabels(browser, dir, step(step(sent, "accept"), "pay"), ["Open"]);
  await inlineLabels(browser, dir, step(sent, "decline"), ["Open"]);

  quote = fresh();
  {
    const { page, card } = await openHost(browser, dir, "dark");
    await assertContrast(card, "inline dark");
    shots.push(await shot(page, "inline-draft-dark"));

    await card.getByRole("button", { name: "Edit" }).click();
    await card.getByRole("button", { name: "Quote settings" }).waitFor();
    assert.equal(await page.evaluate(() => document.body.classList.contains("fullscreen")), true, "Edit asked the host for fullscreen");
    await assertContrast(card, "editor dark");
    shots.push(await shot(page, "fullscreen-edit-dark-390"));
    await card.getByRole("radio", { name: "Customer view" }).click();
    await assertContrast(card, "customer view dark");
    await card.getByRole("button", { name: "Quote settings" }).click();
    await assertContrast(card, "settings dark");
    await page.close();
  }

  {
    const { page, card } = await openHost(browser, dir, "light");
    await card.getByRole("button", { name: "Edit" }).click();
    const bar = card.locator("footer");
    await bar.waitFor();

    const rows = await card.locator("[data-qty-row]").evaluateAll((els) =>
      els.map((row) => {
        const inputs = row.querySelectorAll("input");
        return {
          qty: inputs[0]!.getBoundingClientRect(),
          unit: row.querySelector("[role=button]")!.getBoundingClientRect(),
          price: inputs[1]!.getBoundingClientRect(),
          height: row.getBoundingClientRect().height,
        };
      }),
    );
    assert.equal(rows.length, 7);
    for (const [i, r] of rows.entries()) {
      const centers = [r.qty, r.unit, r.price].map((b) => b.top + b.height / 2);
      assert(Math.max(...centers) - Math.min(...centers) < 2, `line ${i + 1}: qty, unit and price share one row`);
      assert(r.qty.right <= r.unit.left + 1 && r.unit.right < r.price.left, `line ${i + 1}: qty | unit × price in order`);
      assert(r.height <= 46, `line ${i + 1}: the row did not wrap (${r.height}px)`);
    }
    await assertNoHorizontalOverflow(card, "fullscreen edit at 390");
    await assertContrast(card, "editor light");
    await assertFocusVisible(page, card, 40);
    const targets = await card.locator("main button, main input, main [role=button], footer button, header [role=radio], header button").evaluateAll((els) =>
      els
        .filter((el) => el.getClientRects().length > 0 && el.getBoundingClientRect().height < 44)
        .map((el) => `${el.getAttribute("aria-label") ?? el.textContent} ${el.getBoundingClientRect().height}px`),
    );
    assert.deepEqual(targets, [], "touch targets are at least 44px tall");
    const composer = await page.locator("#composer").boundingBox();
    const save = await bar.getByRole("button", { name: "Done" }).boundingBox();
    assert(composer && save && save.y + save.height <= composer.y, "bottom bar sits above the host composer");
    shots.push(await shot(page, "fullscreen-edit-light-390"));

    const total = () => card.locator("[data-total]").textContent();
    const before = await total();
    await card.getByRole("textbox", { name: "Line 3 quantity" }).fill("16");
    assert.notEqual(await total(), before, "bottom-bar total updates live, before Save");
    assert.equal(reviseCalls(), 0, "live totals make no tool call");
    assert.equal(await bar.getByRole("button", { name: "Save" }).count(), 1, "unsaved changes show Save");

    await card.getByRole("listitem", { name: "Line 5" }).getByRole("button", { name: /^Unit/ }).click();
    await card.getByRole("option", { name: "m", exact: true }).click();

    await card.getByRole("button", { name: "Quote settings" }).click();
    const sheet = card.getByRole("dialog", { name: "Quote settings" });
    await sheet.waitFor();
    await sheet.getByLabel("Tax %").fill("9");
    await assertNoHorizontalOverflow(card, "settings sheet at 390");
    await assertContrast(card, "settings light");
    shots.push(await shot(page, "settings-sheet-light-390"));
    await sheet.getByRole("button", { name: "Close" }).click();
    await sheet.waitFor({ state: "hidden" });

    await card.getByRole("radio", { name: "Customer view" }).click();
    const preview = card.getByRole("article", { name: "What the customer sees" });
    await preview.waitFor();
    assert.equal(await card.getByRole("region", { name: "Line items" }).isVisible(), false, "phone shows one pane at a time");
    const widths = await preview.evaluate((el) => {
      const inner = el.getBoundingClientRect().width - 2 * parseFloat(getComputedStyle(el).paddingLeft) - 2;
      return [...el.querySelectorAll("[data-customer-actions] button")].map((b) => ({
        label: b.textContent,
        full: Math.abs(b.getBoundingClientRect().width - inner) < 2,
        disabled: (b as HTMLButtonElement).disabled,
      }));
    });
    assert.deepEqual(
      widths,
      [
        { label: "Accept and pay deposit", full: true, disabled: true },
        { label: "Decline", full: true, disabled: true },
      ],
      "customer view shows full-width, inactive Accept and Decline",
    );
    assert.match((await preview.textContent()) ?? "", /Tax \(9%\)/, "preview reflects the unsaved tax");
    await assertContrast(card, "customer view light");
    await preview.locator("[data-customer-actions]").evaluate((el) => el.scrollIntoView({ block: "end" }));
    shots.push(await shot(page, "customer-view-light-390"));

    await bar.getByRole("button", { name: "Save" }).click();
    await card.getByText(/Saved Q-1013 v1/).waitFor();
    const call = toolCalls.at(-1);
    assert.equal(call?.name, "revise_quote");
    assert.deepEqual(
      call?.arguments.ops,
      [
        { op: "update_item", item_id: quote.items[2]!.id, quantity: 16 },
        { op: "update_item", item_id: quote.items[4]!.id, unit: "m" },
        { op: "set_tax_percent", percent: 9 },
      ],
      "Save sends only the changed fields",
    );
    assert.equal(quote.taxPercent, 9);
    assert.equal(await bar.getByRole("button", { name: "Done" }).count(), 1, "saved draft shows Done");
    const log = (await page.evaluate("window.__log")) as Array<{ method?: string }>;
    assert(log.some((m) => m.method === "ui/update-model-context"), "model told about the edit");

    await bar.getByRole("button", { name: "Done" }).click();
    await card.getByRole("button", { name: "Send quote" }).waitFor();
    assert.equal(await page.evaluate(() => document.body.classList.contains("fullscreen")), false, "Done returned inline");
    await page.close();
  }

  {
    const { page, card } = await openHost(browser, dir, "dark");
    await card.getByRole("button", { name: "Edit" }).click();
    await card.locator("footer").waitFor();
    await card.getByRole("textbox", { name: "Line 1 description" }).focus();
    shots.push(await shot(page, "fullscreen-edit-dark-390-focus"));
    await page.setViewportSize(DESKTOP);
    const [edit, customer] = await Promise.all(
      ["Line items", "Customer view"].map((name) => card.getByRole("region", { name }).boundingBox()),
    );
    assert(edit && customer && customer.x >= edit.x + edit.width && Math.abs(customer.y - edit.y) < 2, "wide screens show the customer view beside the editor");
    assert.equal(await card.getByRole("radio", { name: "Customer view" }).isVisible(), false, "no pane switch on wide screens");
    await assertNoHorizontalOverflow(card, "fullscreen at 1280");
    shots.push(await shot(page, "fullscreen-dark-1280"));
    await page.close();
  }

  {
    const { page } = await openHost(browser, dir, "light", DESKTOP);
    const frame = page.frames().find((f) => f.url().endsWith("card.html"))!;
    await frame.getByRole("button", { name: "Edit" }).click();
    await frame.locator("footer").waitFor();
    shots.push(await shot(page, "fullscreen-light-1280"));
    await page.close();
  }

  quote = step(quote, "send");
  {
    const page = await browser.newPage({ viewport: PHONE });
    const view = resultFor(quote).structuredContent;
    const opened: string[] = [];
    await page.exposeFunction("__opened", (href: string) => opened.push(href));
    await page.addInitScript(
      `window.openai = { toolOutput: ${JSON.stringify(view)}, theme: "dark", displayMode: "inline", locale: "en-US",
         setOpenInAppUrl: ({ href }) => window.__opened(href) };`,
    );
    await page.goto(`file://${join(dir, "card.html")}`);
    await page.locator("article").waitFor();
    await page.emulateMedia({ colorScheme: "light" });
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "dark", "legacy theme applied");
    assert.deepEqual(opened, [`${BASE}/q/${quote.publicToken}`], "setOpenInAppUrl points at the public page");
    assert.deepEqual(await page.locator("article > div:last-child button").allTextContents(), ["Copy link", "Open"]);
    await page.close();
  }

  {
    const page = await browser.newPage({ viewport: PHONE });
    const quotes = [sent, quote, fresh(), fresh(), fresh(), fresh(), fresh()].map((q) => toListEntry(q, NOW));
    await page.addInitScript(`window.openai = { toolOutput: ${JSON.stringify({ quotes })}, theme: "light" };`);
    await page.goto(`file://${join(dir, "card.html")}`);
    await page.getByRole("article", { name: "Quotes" }).waitFor();
    assert.equal(await page.getByRole("heading").textContent(), "7 quotes");
    assert.equal(await page.locator("li").last().textContent(), "+2 more", "list shows 5 quotes then a count");
    shots.push(await shot(page, "list-light-390"));
    await page.close();
  }

  await browser.close();
  console.log(`tool calls: ${toolCalls.map((c) => c.name).join(", ")}`);
  console.log(shots.join("\n"));
}

await main();
