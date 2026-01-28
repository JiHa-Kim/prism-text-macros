import type { Macro } from "./types";

export type BridgeMacro = {
  id?: string;

  // trigger
  trigger: string;              // string trigger OR regex source
  triggerIsRegex?: boolean;
  triggerFlags?: string;

  // replacement
  replacement?: string;         // string replacement when not a function
  isFunc?: boolean;             // if true, replacement is resolved by jsName in pageBridge
  jsName?: string;              // function registry key

  // metadata
  options?: string;
  description?: string;
  priority?: number;
};

export type MacroBridgeRequest =
  | { type: "PING" }
  | { type: "SET_CONFIG"; enabled: boolean; macros: BridgeMacro[] }
  | { type: "SET_SELECTION"; selection: { start: number; end: number } };

export type MacroBridgeResponse =
  | { type: "PONG" }
  | { type: "CONFIG_OK" }
  | { type: "CONFIG_FAIL"; reason: string }
  | { type: "SELECTION_OK" }
  | { type: "SELECTION_FAIL"; reason: string };

export const BRIDGE_CHANNEL = "PRISM_MACRO_BRIDGE";

// Helper for content script: serialize a Macro[] to BridgeMacro[]
export function serializeMacrosForBridge(macros: Macro[]): BridgeMacro[] {
  return macros.map((m) => {
    const isRegex = m.trigger instanceof RegExp;
    const isFunc = typeof m.replacement === "function";

    const out: BridgeMacro = {
      id: m.id,
      trigger: isRegex ? (m.trigger as RegExp).source : String(m.trigger),
      triggerIsRegex: isRegex ? true : undefined,
      triggerFlags: isRegex ? (m.trigger as RegExp).flags : undefined,

      replacement: !isFunc ? String(m.replacement) : undefined,
      isFunc: isFunc ? true : undefined,
      jsName: (m as any).jsName,

      options: m.options,
      description: m.description,
      priority: m.priority,
    };

    return out;
  });
}
