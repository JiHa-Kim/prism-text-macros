import { Macro } from '../lib/types';
import { checkMacroTrigger } from '../lib/macroEngine';
import { expandMacros } from '../lib/macroUtils';
import { defaultSnippets } from '../lib/defaultSnippets';
import { loadMacrosFromStorage } from '../lib/storage';
import { injectBridgeScript, getStateFromBridge, applyEditViaBridge } from './bridge';
import { isEditable, getFallbackEditorState, applyFallbackReplacement, showExpansionFeedback, injectFeedbackStyles, ActiveMacroState } from './handlers';

// State
let enabled = true;
let macros: Macro[] = expandMacros(defaultSnippets);

// Tabstop State
let activeMacro: ActiveMacroState | null = null;

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
const init = async () => {
    try {
        const rawMacros = await loadMacrosFromStorage(chrome.storage.local);
        macros = rawMacros.map((m: any) => {
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
             return m;
        });
    } catch (e) {
        console.error("Prism Macros: Error loading macros", e);
    }
};

init();

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "TOGGLE_STATE") {
    enabled = msg.enabled;
  }
});

let isExpanding = false;

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
        
        // Visual feedback
        showExpansionFeedback(el, match.triggerRange.start, match.replacementText.length);

        isExpanding = true;
        try {
            if (useBridge) {
                const res = await applyEditViaBridge(
                    { start: match.triggerRange.start, end: match.triggerRange.end, text: match.replacementText },
                    { start: match.selection.start, end: match.selection.end }
                );
                if (!res.ok) {
                    console.warn("Prism Macro Debug: Bridge apply failed, falling back", res.reason);
                    const newState = applyFallbackReplacement(el, match);
                    if (newState) activeMacro = newState;
                } else {
                    // Correctly set state for Bridge case too
                    activeMacro = {
                        tabStops: match.tabStops || [],
                        currentStopIndex: -1,
                        startOffset: match.triggerRange.start
                    };
                }
            } else {
                const newState = applyFallbackReplacement(el, match);
                if (newState) activeMacro = newState;
            }
        } finally {
            setTimeout(() => { isExpanding = false; }, 50);
        }
    }
};

// Main Logic
injectBridgeScript();
injectFeedbackStyles();

document.addEventListener("focusin", (e) => {
  const el = e.target as HTMLElement;
  if (el && isEditable(el)) {
    console.log("Prism Macro Debug: Focus on", el.tagName);
  }
});

const handleTabKey = (e: KeyboardEvent, el: HTMLElement) => {
    if (!activeMacro || activeMacro.tabStops.length === 0) return false;

    // Shift+Tab goes back, Tab goes forward
    const direction = e.shiftKey ? -1 : 1;
    let nextIndex = activeMacro.currentStopIndex + direction;

    // Bounds check
    if (nextIndex >= activeMacro.tabStops.length) {
        // Exit active macro mode if we go past the end
        activeMacro = null;
        return false; // Allow default tab behavior (maybe?) or just stop
    }
    if (nextIndex < 0) {
        nextIndex = 0; // Wrap or stay? Let's stay at 0
    }

    const nextStop = activeMacro.tabStops[nextIndex];
    activeMacro.currentStopIndex = nextIndex;

    const absStart = activeMacro.startOffset + nextStop.start;
    const absEnd = activeMacro.startOffset + nextStop.end;

    // Select the tab stop
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
        const input = el as HTMLInputElement | HTMLTextAreaElement;
        input.setSelectionRange(absStart, absEnd);
    } else if (el.tagName === "DIV" || (el as HTMLElement).contentEditable === 'true') {
        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0) {
             console.warn("Prism Macro: Tab navigation in contentEditable is approximate/experimental");
        }
    }
    
    // Prevent inserting a literal tab
    e.preventDefault();
    e.stopImmediatePropagation();
    return true;
};

document.addEventListener("keydown", (e) => {
  if (!enabled) return;
  const el = document.activeElement as HTMLElement;
  if (!isEditable(el)) return;

  if (e.key === "Tab") {
      if (handleTabKey(e, el)) return;
  }

  if (["Control", "Alt", "Meta", "Shift", "CapsLock", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Backspace", "Delete"].includes(e.key)) {
    // Maybe verify if we moved cursor out of bounds -> clear activeMacro?
    return;
  }
  
  if (isExpanding) return;

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

console.log("Prism Text Macros Loaded v0.2.2 (Refactored)");
