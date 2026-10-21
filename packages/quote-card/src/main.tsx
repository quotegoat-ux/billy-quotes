import { App, type McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import { applyDocumentTheme } from "@openai/apps-sdk-ui/theme";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Card, type CardSnapshot } from "./card.tsx";
import { createHost, hostState } from "./host.ts";
import { readPayload, type Payload } from "./payload.ts";

const app = new App(
  { name: "billy-quote-card", version: "1.0.0" },
  { availableDisplayModes: ["inline", "fullscreen"] },
  { autoResize: true },
);
let connected = false;
const host = createHost(app, () => connected);

let snapshot: CardSnapshot = { payload: null, revision: 0, host: hostState(undefined) };
const listeners = new Set<() => void>();
const store = {
  get: () => snapshot,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  update(patch: Partial<CardSnapshot>) {
    snapshot = { ...snapshot, ...patch };
    for (const listener of listeners) listener();
  },
};

function setPayload(payload: Payload | null): void {
  if (!payload) return;
  if (payload.kind === "quote" && payload.quote.links) host.setOpenInAppUrl(payload.quote.links.quote);
  store.update({ payload, revision: snapshot.revision + 1 });
}

const systemDark = window.matchMedia("(prefers-color-scheme: dark)");

function applyHost(ctx: McpUiHostContext | undefined): void {
  const next = hostState(ctx);
  applyDocumentTheme(next.theme ?? (systemDark.matches ? "dark" : "light"));
  store.update({ host: next });
}

app.ontoolresult = (result) => setPayload(readPayload(result.structuredContent));
app.onhostcontextchanged = () => applyHost(app.getHostContext());
systemDark.addEventListener("change", () => applyHost(connected ? app.getHostContext() : undefined));

window.addEventListener("openai:set_globals", () => {
  if (!connected) applyHost(undefined);
  if (!snapshot.payload) setPayload(readPayload(window.openai?.toolOutput));
});

applyHost(undefined);
setPayload(readPayload(window.openai?.toolOutput));

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Card store={store} host={host} setPayload={setPayload} />
  </StrictMode>,
);

app
  .connect()
  .then(() => {
    connected = true;
    applyHost(app.getHostContext());
  })
  .catch(() => {
    connected = false;
  });
