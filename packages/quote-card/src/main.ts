import { describeQuote, type QuoteView } from "@billy/core";
import { App, type McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import { blankRow, draftFromView, opsFromDraft, previewTotals, type EditDraft } from "./edit-ops.ts";
import { createHost, hostState, type HostState } from "./host.ts";
import { readPayload, type Payload } from "./payload.ts";
import { renderEditor, renderInline, renderList, renderPreview, type Action } from "./render.ts";

interface State {
  payload: Payload | null;
  host: HostState;
  busy: boolean;
  notice: string | null;
  error: string | null;
  draft: EditDraft | null;
  draftErrors: string[];
}

const root = document.getElementById("root")!;
const app = new App(
  { name: "billy-quote-card", version: "1.0.0" },
  { availableDisplayModes: ["inline", "fullscreen"] },
  { autoResize: true },
);
let connected = false;
const host = createHost(app, () => connected);

const state: State = {
  payload: null,
  host: hostState(undefined),
  busy: false,
  notice: null,
  error: null,
  draft: null,
  draftErrors: [],
};

function setPayload(payload: Payload | null): void {
  if (!payload) return;
  state.payload = payload;
  state.draft = null;
  state.draftErrors = [];
  if (payload.kind === "quote" && payload.quote.links) host.setOpenInAppUrl(payload.quote.links.quote);
  render();
}

function applyHost(ctx: McpUiHostContext | undefined): void {
  state.host = hostState(ctx);
  const theme = state.host.theme;
  if (theme) document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
  render();
}

async function act(task: () => Promise<void>): Promise<void> {
  state.busy = true;
  state.error = null;
  state.notice = null;
  render();
  try {
    await task();
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
  } finally {
    state.busy = false;
    render();
  }
}

async function callQuoteTool(name: string, args: Record<string, unknown>): Promise<QuoteView | null> {
  const outcome = await host.callTool(name, args);
  if (outcome.isError) throw new Error(outcome.text || `${name} failed`);
  const payload = readPayload(outcome.structured);
  setPayload(payload);
  return payload?.kind === "quote" ? payload.quote : null;
}

async function copy(text: string, label: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Sandboxed frames often lack clipboard permission; a selected textarea plus execCommand still works there.
    const area = Object.assign(document.createElement("textarea"), { value: text });
    document.body.append(area);
    area.select();
    const copied = document.execCommand("copy");
    area.remove();
    if (!copied) throw new Error(`Couldn't copy. The link is ${text}`);
  }
  state.notice = `${label} copied.`;
}

function inlineActions(view: QuoteView): { primary?: Action; secondary?: Action } {
  if (view.status === "draft") return draftActions(view);
  const links = view.links;
  if (!links) return {};
  const open: Action = { label: "Open", run: () => void act(() => host.openLink(links.quote)) };
  switch (view.status) {
    case "sent":
      return { primary: { label: "Copy link", run: () => void act(() => copy(links.quote, "Quote link")) }, secondary: open };
    case "accepted":
      return { primary: { label: "Copy pay link", run: () => void act(() => copy(links.pay, "Pay link")) }, secondary: open };
    case "paid":
    case "declined":
      return { secondary: open };
    default: {
      const exhaustive: never = view.status;
      return exhaustive;
    }
  }
}

function draftActions(view: QuoteView): { primary: Action; secondary: Action } {
  const send = async () => {
    const sent = await callQuoteTool("send_quote", { quote: view.id });
    if (sent) await host.updateModelContext(`The user sent ${sent.number} from the card.\n${describeQuote(sent)}`, { quote: sent });
  };
  const edit = async () => {
    if (!state.host.canFullscreen) {
      await host.sendMessage(`I'd like to edit quote ${view.number}.`);
      return;
    }
    const mode = await host.requestDisplayMode("fullscreen");
    state.host = { ...state.host, displayMode: mode };
  };
  return {
    primary: { label: "Send quote", busyLabel: "Sending…", run: () => void act(send) },
    secondary: { label: "Edit", run: () => void act(edit) },
  };
}

function updatePreview(view: QuoteView, draft: EditDraft): void {
  const slot = document.getElementById("preview");
  if (!slot) return;
  try {
    const deposit = Number(draft.depositPercent || "0");
    slot.replaceChildren(renderPreview(view, previewTotals(view, draft), Number.isFinite(deposit) ? deposit : view.depositPercent));
  } catch {
    slot.replaceChildren();
  }
}

function save(view: QuoteView, draft: EditDraft): void {
  const result = opsFromDraft(view, draft);
  if (!result.ok) {
    state.draftErrors = result.errors;
    render();
    return;
  }
  state.draftErrors = [];
  if (result.ops.length === 0) {
    state.notice = "No changes to save.";
    render();
    return;
  }
  void act(async () => {
    const saved = await callQuoteTool("revise_quote", { quote: view.id, ops: result.ops });
    if (!saved) return;
    state.notice = `Saved ${saved.number} v${saved.version}.`;
    await host.updateModelContext(`The user edited ${saved.number} in the card. Current quote:\n${describeQuote(saved)}`, { quote: saved });
  });
}

function render(): void {
  const { payload } = state;
  if (!payload) {
    root.replaceChildren();
    return;
  }
  if (payload.kind === "list") {
    root.replaceChildren(renderList(payload.quotes));
    return;
  }
  const view = payload.quote;
  const editable = view.status === "draft" || view.status === "sent";
  if (state.host.displayMode === "fullscreen" && editable) {
    const draft = (state.draft ??= draftFromView(view));
    root.replaceChildren(
      renderEditor({
        view,
        draft,
        busy: state.busy,
        errors: state.draftErrors,
        notice: state.notice,
        error: state.error,
        bottomInset: state.host.bottomInset,
        onChange: () => updatePreview(view, draft),
        onAddRow: () => {
          draft.rows.push(blankRow());
          render();
        },
        onRemoveRow: (index) => {
          draft.rows.splice(index, 1);
          render();
        },
        onSave: () => save(view, draft),
        onDone: () =>
          void act(async () => {
            const mode = await host.requestDisplayMode("inline");
            state.host = { ...state.host, displayMode: mode };
          }),
      }),
    );
    updatePreview(view, draft);
    return;
  }
  root.replaceChildren(
    renderInline({ view, locale: state.host.locale, busy: state.busy, notice: state.notice, error: state.error, ...inlineActions(view) }),
  );
}

app.ontoolresult = (result) => setPayload(readPayload(result.structuredContent));
app.onhostcontextchanged = () => applyHost(app.getHostContext());

window.addEventListener("openai:set_globals", () => {
  if (!connected) applyHost(undefined);
  if (!state.payload) setPayload(readPayload(window.openai?.toolOutput));
});

applyHost(undefined);
setPayload(readPayload(window.openai?.toolOutput));

app
  .connect()
  .then(() => {
    connected = true;
    applyHost(app.getHostContext());
  })
  .catch(() => {
    connected = false;
  });
