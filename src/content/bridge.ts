import { BRIDGE_CHANNEL, MacroBridgeRequest, MacroBridgeResponse } from '../lib/protocol';

export function sendToBridge(req: MacroBridgeRequest) {
  window.postMessage({ channel: BRIDGE_CHANNEL, payload: req }, "*");
}

export function waitForBridgeResponse<T extends MacroBridgeResponse["type"]>(
  type: T,
  timeoutMs = 300
): Promise<Extract<MacroBridgeResponse, { type: T }>> {
  return new Promise((resolve, reject) => {
    const t = window.setTimeout(() => {
      window.removeEventListener("message", onMsg);
      reject(new Error("Bridge timeout: " + type));
    }, timeoutMs);

    function onMsg(evt: MessageEvent) {
      const data = evt.data as any;
      if (!data || data.channel !== BRIDGE_CHANNEL) return;
      const resp = data.payload as MacroBridgeResponse;
      if (!resp || resp.type !== type) return;

      window.clearTimeout(t);
      window.removeEventListener("message", onMsg);
      resolve(resp as any);
    }

    window.addEventListener("message", onMsg);
  });
}

export function injectBridgeScript() {
  const s = document.createElement("script");
  // Update path to dist/pageBridge.js (bundled)
  // Usually this is correct if the key matches web_accessible_resources
  s.src = chrome.runtime.getURL("dist/content/pageBridge.js"); 
  s.type = "text/javascript";
  (document.head || document.documentElement).appendChild(s);
  s.onload = () => s.remove();
}

export async function getStateFromBridge() {
  try {
    sendToBridge({ type: "GET_STATE" });
    const resp = await waitForBridgeResponse("STATE", 200);
    return resp;
  } catch (e) {
    return { ok: false, reason: String(e) } as const;
  }
}

export async function applyEditViaBridge(edit: { start: number; end: number; text: string }, selection: { start: number; end: number }) {
  sendToBridge({ type: "APPLY_EDIT", edit, selection });
  try {
    const resp = await waitForBridgeResponse("APPLY_OK", 300);
    return { ok: true } as const;
  } catch (e) {
    // Check if it failed explicitly
    try {
        const fail = await waitForBridgeResponse("APPLY_FAIL", 50);
        return { ok: false, reason: fail.reason } as const;
    } catch {
        return { ok: false, reason: "Timeout" } as const;
    }
  }
}

export function setSelectionViaBridge(selection: { start: number; end: number }) {
  sendToBridge({ type: "SET_SELECTION", selection });
}
