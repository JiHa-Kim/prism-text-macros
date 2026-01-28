
import { Macro } from './types';
import { checkMacroTrigger, processReplacement } from './macroEngine';
import { defaultSnippets } from './defaultSnippets';
import { normalizeKeyCombo } from './keybindUtils';

// State
let enabled = true;
let macros: Macro[] = defaultSnippets;
let tabStops: { el: HTMLElement, stops: number[] } | null = null;

// Load initial state
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

// Utilities
const isEditable = (el: Element | null): boolean => {
  if (!el) return false;
  // Explicitly target Monaco Editor parts
  if (el.classList.contains("native-edit-context")) return true;
  if (el.classList.contains("ime-text-area")) return true;

  // Invert logic: Ignore standard inputs explicitly to avoid chat zones
  // unless we decide otherwise. The user wanted "opposite", so we disable these.
  if (el.tagName === "TEXTAREA") return false;
  if (el.tagName === "INPUT" && (el as HTMLInputElement).type === "text") return false;
  
  // Keep contentEditable check? Or disable it too?
  // Use caution. Prism might use contentEditable.
  // But strict reading of "opposite" implies checking specifically for the code editor.
  // For now, let's strictly target the classes found in the trace.
  
  return false;
};

// Main Logic
document.addEventListener("keydown", (e) => {
  if (!enabled) return;
  const el = document.activeElement as HTMLElement;
  if (!isEditable(el)) return;

  // Handle Tab Navigation
  if (e.key === 'Tab') {
    // TODO: Implement tab stop navigation
    // This requires tracking where we are. 
    // For MVP, we might skip complex tab stops or implement simple forward jump.
    return;
  }

  // Expanding is usually done on specific keys or every input.
  // We check on 'input' event usually, but for some keys like Space/Enter, we might check here.
}, true);

document.addEventListener("input", (e) => {
  if (!enabled) return;
  const el = e.target as HTMLElement;
  if (!isEditable(el)) return;

  // We need to get the cursor position and text
  // Differs for textarea vs contenteditable
  let text = "";
  let cursor = 0;

  if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
    const input = el as HTMLInputElement | HTMLTextAreaElement;
    text = input.value;
    cursor = input.selectionEnd || 0;
  } else {
    text = el.innerText; // Rough approximation
    // Contenteditable cursor position is hard.
    // For Prism, it uses specific editors. 
    // If we assume a generic contenteditable, we need Selection API.
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      // This is complex. We'll try to use a simplified version for MVP
      // or just support Textarea first.
      // Many online editors use hidden textareas.
    }
  }

  if (!text) return;

  // Check Trigger
  const match = checkMacroTrigger(text, cursor, macros);
  if (match) {
    // Apply replacement
    const { text: newText, selection, tabStops: stops } = match;

    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
      const input = el as HTMLInputElement;
      // We need to execCommand or set value to preserve undo stack if possible
      // But valid 'insertText' is hard with arbitrary replacements.
      // Replacing value directly clears undo stack usually.
      document.execCommand("selectAll", false); // Hacky
      document.execCommand("insertText", false, newText);

      // Restore cursor
      input.setSelectionRange(selection.start, selection.end);
    }
  }
});

console.log("Prism Text Macros Loaded");
