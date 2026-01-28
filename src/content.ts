import { Macro } from './types';
import { checkMacroTrigger } from './macroEngine';
import { defaultSnippets } from './defaultSnippets';
import { BRIDGE_CHANNEL, MacroBridgeRequest, MacroBridgeResponse } from './protocol';

// State
let enabled = true;
let macros: Macro[] = defaultSnippets;

// Registry for function replacers
const functionRegistry: Record<string, (match: any) => string> = {
    "identity_matrix": (match: any) => {
        const n = parseInt(match[1]);
        if (isNaN(n)) return "";
        let arr: number[][] = [];
        for (let j = 0; j < n; j++) {
            arr[j] = [];
            for (let i = 0; i < n; i++) {
                arr[j][i] = (i === j) ? 1 : 0;
            }
        }
        let output = arr.map(el => el.join(" & ")).join(" \\\\\n");
        output = `\\begin{pmatrix}\n${output}\n\\end{pmatrix}`;
        return output;
    }
};

// Load initial state
chrome.storage.sync.get(["snips"], (result) => {
  if (result.snips && Array.isArray(result.snips)) {
    macros = result.snips.map((m: any) => {
        // Hydrate Regex
        if (m.isRegex && typeof m.trigger === 'string') {
            try {
                return { ...m, trigger: new RegExp(m.trigger) };
            } catch { return m; }
        }
        // Hydrate Functions via Registry
        if (m.isFunc && m.jsName && functionRegistry[m.jsName]) {
             return { ...m, replacement: functionRegistry[m.jsName] };
        }
        // Fallback or skip unsafe functions
        return m;
    });
  }
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "TOGGLE_STATE") {
    enabled = msg.enabled;
  }
});

// Bridge Logic
function sendToBridge(req: MacroBridgeRequest) {
  window.postMessage({ channel: BRIDGE_CHANNEL, payload: req }, "*");
}

function waitForBridgeResponse<T extends MacroBridgeResponse["type"]>(
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

function injectBridgeScript() {
  const s = document.createElement("script");
  s.src = chrome.runtime.getURL("dist/pageBridge.js"); // We'll bundle it here
  s.type = "text/javascript";
  (document.head || document.documentElement).appendChild(s);
  s.onload = () => s.remove();
}

async function getStateFromBridge() {
  try {
    sendToBridge({ type: "GET_STATE" });
    const resp = await waitForBridgeResponse("STATE", 200);
    return resp;
  } catch (e) {
    return { ok: false, reason: String(e) } as const;
  }
}

async function applyEditViaBridge(edit: { start: number; end: number; text: string }, selection: { start: number; end: number }) {
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

// Utilities
const isEditable = (el: Element | null): boolean => {
  if (!el) return false;

  const tagName = el.tagName;
  const isContentEditable = (el as HTMLElement).contentEditable === 'true';

  if (el.classList.contains("native-edit-context")) return true;
  if (el.classList.contains("ime-text-area")) return true;
  if (el.classList.contains("monaco-mouse-cursor-text")) return true;
  if (el.closest('.monaco-editor')) return true;

  if (tagName === "TEXTAREA") return true;
  if (tagName === "INPUT" && (el as HTMLInputElement).type === "text") return true;
  if (isContentEditable) return true;
  
  return false;
};

let isExpanding = false;

// Helper to get text and cursor (Fallback)
const getFallbackEditorState = (el: HTMLElement): { text: string, cursor: number } => {
  const ec = (el as any).editContext;
  if (ec) return { text: ec.text, cursor: ec.selectionEnd };

  if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
    const input = el as HTMLInputElement | HTMLTextAreaElement;
    return { text: input.value, cursor: input.selectionEnd || 0 };
  }

  const sel = window.getSelection();
  let cursor = 0;
  if (sel && sel.rangeCount > 0) cursor = sel.focusOffset;
  return { text: el.innerText || (el as any).value || "", cursor };
};

// Helper to apply replacement (Fallback)
const applyFallbackReplacement = (el: HTMLElement, match: any) => {
  const { replacementText, triggerRange, selection } = match;
  const ec = (el as any).editContext;
  
  if (ec) {
    try {
      ec.updateText(triggerRange.start, triggerRange.end, replacementText);
      ec.updateSelection(selection.start, selection.end);
      
      el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      
      let event;
      if (typeof (window as any).TextUpdateEvent === 'function') {
        event = new (window as any).TextUpdateEvent('textupdate', {
          updateRangeStart: triggerRange.start,
          updateRangeEnd: triggerRange.end,
          text: replacementText,
          selectionStart: selection.start,
          selectionEnd: selection.end,
          bubbles: true
        });
      } else {
        event = new CustomEvent('textupdate', {
          bubbles: true,
          detail: {
            updateRangeStart: triggerRange.start,
            updateRangeEnd: triggerRange.end,
            text: replacementText,
            selectionStart: selection.start,
            selectionEnd: selection.end
          }
        });
        Object.assign(event, {
            updateRangeStart: triggerRange.start,
            updateRangeEnd: triggerRange.end,
            text: replacementText,
            selectionStart: selection.start,
            selectionEnd: selection.end
        });
      }
      
      el.dispatchEvent(event);
      try { ec.dispatchEvent(event); } catch {}
      el.dispatchEvent(new CompositionEvent('compositionend', { data: replacementText, bubbles: true }));

      el.dispatchEvent(new InputEvent('input', {
        inputType: 'insertReplacementText',
        data: replacementText,
        bubbles: true
      }));
      return;
    } catch (e) {
      console.error("Prism Macro Debug: EditContext replacement failed", e);
    }
  }

  if (el.tagName === "DIV" || (el as HTMLElement).contentEditable === 'true') {
    el.focus();
    try {
      document.execCommand("insertText", false, replacementText);
    } catch (e) {
      console.error("Prism Macro Debug: ContentEditable replacement failed", e);
    }
    return;
  }

  if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
    const input = el as HTMLInputElement | HTMLTextAreaElement;
    const scrollTop = input.scrollTop;
    input.focus();
    input.setSelectionRange(triggerRange.start, triggerRange.end);
    const success = document.execCommand("insertText", false, replacementText);
    if (!success) {
       const val = input.value;
       input.value = val.slice(0, triggerRange.start) + replacementText + val.slice(triggerRange.end);
    }
    input.setSelectionRange(selection.start, selection.end);
    input.scrollTop = scrollTop;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  } else {
    el.innerText = replacementText;
  }
};

const handleMacroExpansion = async (el: HTMLElement) => {
  if (isExpanding || !enabled) return;

  // 1. Try Bridge
  const bridgeState = await getStateFromBridge();
  let text = "", cursor = 0;
  let useBridge = false;

  if (bridgeState.ok) {
    text = bridgeState.text;
    cursor = bridgeState.cursor;
    useBridge = true;
  } else {
    // 2. Fallback
    const fallback = getFallbackEditorState(el);
    text = fallback.text;
    cursor = fallback.cursor;
  }

  if (!text) return;

  const match = checkMacroTrigger(text, cursor, macros);
  if (match) {
    console.log(`Prism Macro Debug: Macro Triggered! [${text.slice(match.triggerRange.start, match.triggerRange.end)}] ->`, match.replacementText);
    
    isExpanding = true;
    try {
      if (useBridge) {
        const res = await applyEditViaBridge(
          { start: match.triggerRange.start, end: match.triggerRange.end, text: match.replacementText },
          { start: match.selection.start, end: match.selection.end }
        );
        if (!res.ok) {
          console.warn("Prism Macro Debug: Bridge apply failed, falling back", res.reason);
          applyFallbackReplacement(el, match);
        }
      } else {
        applyFallbackReplacement(el, match);
      }
    } finally {
      setTimeout(() => { isExpanding = false; }, 50);
    }
  }
};

// Main Logic
injectBridgeScript();

document.addEventListener("focusin", (e) => {
  const el = e.target as HTMLElement;
  if (el && isEditable(el)) {
    console.log("Prism Macro Debug: Focus on", el.tagName);
  }
});

document.addEventListener("keydown", (e) => {
  if (!enabled || isExpanding) return;
  const el = document.activeElement as HTMLElement;
  if (!isEditable(el)) return;

  if (["Control", "Alt", "Meta", "Shift", "CapsLock", "Tab", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
    return;
  }

  // Keydown triggers after the character is inserted (usually) or we wait
  // For better Monaco sync, we wait a tiny bit
  setTimeout(() => handleMacroExpansion(el), 10);
}, true);

document.addEventListener("input", (e) => {
  if (!enabled || isExpanding) return;
  const el = e.target as HTMLElement;
  if (!isEditable(el)) return;

  handleMacroExpansion(el);
});

console.log("Prism Text Macros Loaded v0.2.0 (Monaco Bridge Enabled)");
