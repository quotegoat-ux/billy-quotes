import { describeQuote, type QuoteView, type ReviseOpInput } from "@billy/core";
import { useState, useSyncExternalStore } from "react";
import { Editor } from "./editor.tsx";
import type { Host, HostState } from "./host.ts";
import { InlineCard, QuoteList, type Action } from "./inline.tsx";
import { readPayload, type Payload } from "./payload.ts";

export interface CardSnapshot {
  payload: Payload | null;
  /** Bumps on every new payload, so the editor knows its draft was saved or replaced. */
  revision: number;
  host: HostState;
}

interface Store {
  get: () => CardSnapshot;
  subscribe: (listener: () => void) => () => void;
  update: (patch: Partial<CardSnapshot>) => void;
}

interface Feedback {
  busy: boolean;
  notice: string | null;
  error: string | null;
}

async function copy(text: string, label: string): Promise<string> {
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
  return `${label} copied.`;
}

export function Card({ store, host, setPayload }: { store: Store; host: Host; setPayload: (payload: Payload | null) => void }) {
  const { payload, revision, host: hostState } = useSyncExternalStore(store.subscribe, store.get);
  const [feedback, setFeedback] = useState<Feedback>({ busy: false, notice: null, error: null });

  /** Runs one user action; a returned string becomes the notice. */
  const act = (task: () => Promise<string | void>) => {
    setFeedback({ busy: true, notice: null, error: null });
    task().then(
      (notice) => setFeedback({ busy: false, notice: notice ?? null, error: null }),
      (error: unknown) => setFeedback({ busy: false, notice: null, error: error instanceof Error ? error.message : String(error) }),
    );
  };

  async function callQuoteTool(name: string, args: Record<string, unknown>): Promise<QuoteView | null> {
    const outcome = await host.callTool(name, args);
    if (outcome.isError) throw new Error(outcome.text || `${name} failed`);
    const next = readPayload(outcome.structured);
    setPayload(next);
    return next?.kind === "quote" ? next.quote : null;
  }

  async function setDisplayMode(mode: "inline" | "fullscreen"): Promise<void> {
    const granted = await host.requestDisplayMode(mode);
    store.update({ host: { ...store.get().host, displayMode: granted } });
  }

  function inlineActions(view: QuoteView): { primary?: Action; secondary?: Action } {
    if (view.status === "draft") {
      const send = async () => {
        const sent = await callQuoteTool("send_quote", { quote: view.id });
        if (sent) await host.updateModelContext(`The user sent ${sent.number} from the card.\n${describeQuote(sent)}`, { quote: sent });
      };
      const edit = async () => {
        if (hostState.canFullscreen) await setDisplayMode("fullscreen");
        else await host.sendMessage(`I'd like to edit quote ${view.number}.`);
      };
      return {
        primary: { label: "Send quote", busyLabel: "Sending…", run: () => act(send) },
        secondary: { label: "Edit", run: () => act(edit) },
      };
    }
    const links = view.links;
    if (!links) return {};
    const open: Action = { label: "Open", run: () => act(() => host.openLink(links.quote)) };
    switch (view.status) {
      case "sent":
        return { primary: { label: "Copy link", run: () => act(() => copy(links.quote, "Quote link")) }, secondary: open };
      case "accepted":
        return { primary: { label: "Copy pay link", run: () => act(() => copy(links.pay, "Pay link")) }, secondary: open };
      case "paid":
      case "declined":
        return { secondary: open };
      default: {
        const exhaustive: never = view.status;
        return exhaustive;
      }
    }
  }

  if (!payload) return null;
  if (payload.kind === "list") return <QuoteList quotes={payload.quotes} />;
  const view = payload.quote;
  const editable = view.status === "draft" || view.status === "sent";
  if (hostState.displayMode === "fullscreen" && editable) {
    return (
      <Editor
        view={view}
        revision={revision}
        locale={hostState.locale}
        bottomInset={hostState.bottomInset}
        {...feedback}
        onSave={(ops: ReviseOpInput[]) =>
          act(async () => {
            const saved = await callQuoteTool("revise_quote", { quote: view.id, ops });
            if (!saved) return;
            await host.updateModelContext(`The user edited ${saved.number} in the card. Current quote:\n${describeQuote(saved)}`, { quote: saved });
            return `Saved ${saved.number} v${saved.version}.`;
          })
        }
        onDone={() => act(() => setDisplayMode("inline"))}
      />
    );
  }
  return <InlineCard view={view} locale={hostState.locale} {...feedback} {...inlineActions(view)} />;
}
