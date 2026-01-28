import {
  BRIDGE_CHANNEL,
  MacroBridgeRequest,
  MacroBridgeResponse,
  BridgeMacro,
} from "../lib/protocol";

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
  s.src = chrome.runtime.getURL("dist/content/pageBridge.js");
  s.type = "text/javascript";
  (document.head || document.documentElement).appendChild(s);
  s.onload = () => s.remove();
}

export async function pingBridge(timeoutMs = 200): Promise<boolean> {
  try {
    sendToBridge({ type: "PING" });
    await waitForBridgeResponse("PONG", timeoutMs);
    return true;
  } catch {
    return false;
  }
}

export async function setConfigViaBridge(enabled: boolean, macros: BridgeMacro[]) {
  sendToBridge({ type: "SET_CONFIG", enabled, macros });
  try {
    await waitForBridgeResponse("CONFIG_OK", 300);
    return { ok: true } as const;
  } catch (e) {
    // If it failed explicitly
    try {
      const fail = await waitForBridgeResponse("CONFIG_FAIL", 50);
      return { ok: false, reason: fail.reason } as const;
    } catch {
      return { ok: false, reason: String(e) } as const;
    }
  }
}

export function setSelectionViaBridge(selection: { start: number; end: number }) {
  sendToBridge({ type: "SET_SELECTION", selection });
}
