import { Macro } from "../lib/types";
import { checkMacroTrigger } from "../lib/macroEngine";
import { expandMacros } from "../lib/macroUtils";
import { defaultSnippets } from "../lib/defaultSnippets";
import { loadMacrosFromStorage } from "../lib/storage";
import {
  injectBridgeScript,
  pingBridge,
  setConfigViaBridge,
  setSelectionViaBridge,
} from "./bridge";
import {
  isEditable,
  getFallbackEditorState,
  applyFallbackReplacement,
  showExpansionFeedback,
  injectFeedbackStyles,
  ActiveMacroState,
  setContentEditableSelection,
} from "./handlers";
import { serializeMacrosForBridge } from "../lib/protocol";

// State
let enabled = true;
let macros: Macro[] = expandMacros(defaultSnippets);

// Tabstop State (fallback editors only)
let activeMacro: ActiveMacroState | null = null;

// Registry for function replacers (fallback editors use real functions)
const functionRegistry: Record<string, (match: any) => string> = {
  identity_matrix: (match: any) => {
    const n = parseInt(match[1]);
    if (isNaN(n)) return "";
    const arr: number[][] = [];
    for (let j = 0; j < n; j++) {
      arr[j] = [];
      for (let i = 0; i < n; i++) {
        arr[j][i] = i === j ? 1 : 0;
      }
    }
    let output = arr.map((el) => el.join(" & ")).join(" \\\\\n");
    output = `\\begin{pmatrix}\n${output}\n\\end{pmatrix}`;
    return output;
  },
};

function isMonacoElement(el: HTMLElement | null): boolean {
  if (!el) return false;
  return !!el.closest(".monaco-editor");
}

async function syncConfigToBridge() {
  // Robust handshake: pageBridge might not be ready immediately after injection.
  for (let i = 0; i < 10; i++) {
    const ok = await pingBridge(150);
    if (!ok) {
      await new Promise((r) => setTimeout(r, 50));
      continue;
    }

    const payload = serializeMacrosForBridge(macros);
    await setConfigViaBridge(enabled, payload);
    return;
  }
  // If bridge isn't present, that's fine: fallback editors still work.
}

const hydrateMacros = (rawMacros: any[]) => {
    return rawMacros.map((m: any) => {
      // Hydrate Regex
      if (m.isRegex && typeof m.trigger === "string") {
        try {
          return { ...m, trigger: new RegExp(m.trigger) };
        } catch {
          return m;
        }
      }
      // Hydrate Functions via Registry
      if (m.isFunc && m.jsName && functionRegistry[m.jsName]) {
        return { ...m, replacement: functionRegistry[m.jsName] };
      }
      return m;
    });
};

const loadMacros = async (providedMacros?: any[]) => {
  try {
    const rawMacros = providedMacros || await loadMacrosFromStorage(chrome.storage.local);
    macros = hydrateMacros(rawMacros);
    macros = expandMacros(macros);
  } catch (e) {
    console.error("Prism Macros: Error loading macros", e);
  } finally {
    // Update Monaco-side config after we have real macros
    syncConfigToBridge();
  }
};

const init = async () => {
    await loadMacros();
};

init();

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "TOGGLE_STATE") {
    enabled = msg.enabled;
    syncConfigToBridge();
  } else if (msg.type === "MACROS_UPDATED") {
    // Hot reload macros
    if (msg.macros) {
        console.log("Prism Macros: Reloading macros from message data...");
        loadMacros(msg.macros);
    } else {
        console.log("Prism Macros: Reloading macros from storage...");
        loadMacros();
    }
  }
});

let isExpanding = false;

const handleMacroExpansionFallbackOnly = async (el: HTMLElement) => {
  if (isExpanding || !enabled) return;
  if (isMonacoElement(el)) return; // Monaco is handled in pageBridge

  const fallback = getFallbackEditorState(el);
  const text = fallback.text;
  const cursor = fallback.cursor;

  if (!text) return;

  const match = checkMacroTrigger(text, cursor, macros);
  if (!match) return;


  showExpansionFeedback(el, match.triggerRange.start, match.replacementText.length);

  isExpanding = true;
  try {
    const newState = applyFallbackReplacement(el, match);
    if (newState) activeMacro = newState;
  } finally {
    setTimeout(() => {
      isExpanding = false;
    }, 50);
  }
};

// Main Logic
injectBridgeScript();
injectFeedbackStyles();
syncConfigToBridge();

document.addEventListener("focusin", (e) => {
  const el = e.target as HTMLElement;
  if (el && isEditable(el)) {
    // Focused
  }
});

const handleTabKey = (e: KeyboardEvent, el: HTMLElement) => {
  // Monaco tabstops are handled in pageBridge via Monaco commands.
  if (isMonacoElement(el)) return false;

  if (!activeMacro || activeMacro.tabStops.length === 0) return false;

  const direction = e.shiftKey ? -1 : 1;
  let nextIndex = activeMacro.currentStopIndex + direction;

  if (nextIndex >= activeMacro.tabStops.length) {
    activeMacro = null;
    return false;
  }
  if (nextIndex < 0) nextIndex = 0;

  const nextStop = activeMacro.tabStops[nextIndex];
  activeMacro.currentStopIndex = nextIndex;

  const absStart = nextStop.start;
  const absEnd = nextStop.end;

  // Select the tab stop
  if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
    const input = el as HTMLInputElement | HTMLTextAreaElement;
    input.setSelectionRange(absStart, absEnd);
  } else if (el.tagName === "DIV" || (el as HTMLElement).contentEditable === "true") {
    setContentEditableSelection(el, absStart, absEnd);
  }

  e.preventDefault();
  e.stopImmediatePropagation();
  return true;
};

document.addEventListener(
  "keydown",
  (e) => {
    if (!enabled) return;

    const el = document.activeElement as HTMLElement;
    if (!isEditable(el)) return;

    if (e.key === "Tab") {
      if (handleTabKey(e, el)) return;
    }

    // Don't try to macro-expand on special keys
    if (
      [
        "Control",
        "Alt",
        "Meta",
        "Shift",
        "CapsLock",
        "ArrowLeft",
        "ArrowRight",
        "ArrowUp",
        "ArrowDown",
        "Backspace",
        "Delete",
      ].includes(e.key)
    ) {
      return;
    }

    if (isExpanding) return;

    // For fallback editors, schedule a tiny delay so the character lands first.
    if (!isMonacoElement(el)) {
      setTimeout(() => handleMacroExpansionFallbackOnly(el), 10);
    }
  },
  true
);

document.addEventListener("input", (e) => {
  if (!enabled || isExpanding) return;
  const el = e.target as HTMLElement;
  if (!isEditable(el)) return;
  if (isMonacoElement(el)) return; // Monaco is handled in pageBridge

  handleMacroExpansionFallbackOnly(el);
});

console.log("Prism Text Macros Loaded v0.3.0 (Monaco handled in pageBridge)");
