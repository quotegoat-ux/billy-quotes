import type { App, McpUiDisplayMode, McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import { isRecord } from "./payload.ts";

/** The parts of ChatGPT's legacy window.openai bridge the card feature-detects. */
interface OpenAiBridge {
  toolOutput?: unknown;
  theme?: "light" | "dark";
  displayMode?: McpUiDisplayMode;
  locale?: string;
  callTool?: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  openExternal?: (options: { href: string }) => void;
  requestDisplayMode?: (options: { mode: McpUiDisplayMode }) => Promise<{ mode: McpUiDisplayMode }>;
  sendFollowUpMessage?: (options: { prompt: string }) => Promise<void>;
  setOpenInAppUrl?: (options: { href: string }) => void;
}

declare global {
  interface Window {
    openai?: OpenAiBridge;
  }
}

export interface HostState {
  theme: "light" | "dark" | undefined;
  displayMode: McpUiDisplayMode;
  canFullscreen: boolean;
  locale: string | undefined;
  bottomInset: number;
}

export interface ToolOutcome {
  structured: unknown;
  isError: boolean;
  text: string;
}

export function hostState(ctx: McpUiHostContext | undefined): HostState {
  const openai = window.openai;
  return {
    theme: ctx?.theme ?? openai?.theme,
    displayMode: ctx?.displayMode ?? openai?.displayMode ?? "inline",
    canFullscreen:
      ctx?.availableDisplayModes?.includes("fullscreen") ?? typeof openai?.requestDisplayMode === "function",
    locale: ctx?.locale ?? openai?.locale,
    bottomInset: ctx?.safeAreaInsets?.bottom ?? 0,
  };
}

function textOf(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .map((block: unknown) => (isRecord(block) && typeof block.text === "string" ? block.text : ""))
    .join("\n");
}

/**
 * Prefers the MCP Apps bridge and falls back to window.openai when the
 * handshake never completed, so one card works in both hosts.
 */
export function createHost(app: App, isConnected: () => boolean) {
  return {
    async callTool(name: string, args: Record<string, unknown>): Promise<ToolOutcome> {
      if (isConnected()) {
        const result = await app.callServerTool({ name, arguments: args });
        return { structured: result.structuredContent, isError: result.isError === true, text: textOf(result.content) };
      }
      const call = window.openai?.callTool;
      if (!call) throw new Error("This host can't run actions from the card.");
      const result: unknown = await call(name, args);
      const record = isRecord(result) ? result : {};
      return { structured: record.structuredContent, isError: record.isError === true, text: textOf(record.content) };
    },

    async openLink(url: string): Promise<void> {
      if (isConnected()) {
        await app.openLink({ url });
        return;
      }
      if (window.openai?.openExternal) window.openai.openExternal({ href: url });
      else window.open(url, "_blank", "noopener");
    },

    async requestDisplayMode(mode: McpUiDisplayMode): Promise<McpUiDisplayMode> {
      if (isConnected()) return (await app.requestDisplayMode({ mode })).mode;
      const request = window.openai?.requestDisplayMode;
      return request ? (await request({ mode })).mode : "inline";
    },

    async sendMessage(text: string): Promise<void> {
      if (isConnected()) {
        await app.sendMessage({ role: "user", content: [{ type: "text", text }] });
        return;
      }
      await window.openai?.sendFollowUpMessage?.({ prompt: text });
    },

    async updateModelContext(text: string, structured: Record<string, unknown>): Promise<void> {
      if (!isConnected()) return;
      await app.updateModelContext({ content: [{ type: "text", text }], structuredContent: structured });
    },

    setOpenInAppUrl(url: string): void {
      window.openai?.setOpenInAppUrl?.({ href: url });
    },
  };
}

export type Host = ReturnType<typeof createHost>;
