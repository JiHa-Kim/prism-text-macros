
import { Macro } from './types';
import { checkMacroTrigger, processReplacement } from './macroEngine';
import { defaultSnippets } from './defaultSnippets';
import { normalizeKeyCombo } from './keybindUtils';

// State
let enabled = true;
let macros: Macro[] = defaultSnippets;
let tabStops: { el: HTMLElement, stops: number[] } | null = null;

// Load initial state
chrome.storage.sync.get(["snips"], (result) => {
  if (result.snips && Array.isArray(result.snips)) {
    // We need to re-hydrate Regexps if we stored them as strings
    // See options.ts logic. 
    // For now, let's assume if it looks like a regex source, we might need to handle it, 
    // but 'checkMacroTrigger' handles string vs RegExp triggers. 
    macros = result.snips.map((m: any) => {
      if (m.isRegex && typeof m.trigger === 'string') {
        try {
          // We probably need stored flags too if we want to be perfect, 
          // but usually 'm' flag is used. 
          // Let's assume standard behavior or stick to string triggers if complex.
          return { ...m, trigger: new RegExp(m.trigger) };
        } catch { return m; }
      }
      if (m.isFunc && typeof m.replacement === 'string') {
        // DANGEROUS: new Function usage. 
        // In MV3 content scripts, this might be blocked by CSP.
        // If blocked, we fall back to string replacement or warn.
        try {
          // Try to reconstruct function. 
          // 'm.replacement' is "function (match) { ... }" or "(match) => { ... }"
          // We can wrap it in "return " + str?
          const fn = new Function("return " + m.replacement)();
          return { ...m, replacement: fn };
        } catch (e) { console.warn("Cannot hydrate function macro", e); return m; }
      }
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
  if (el.tagName === "TEXTAREA") return true;
  if (el.tagName === "INPUT" && (el as HTMLInputElement).type === "text") return true;
  if ((el as HTMLElement).isContentEditable) return true;
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
