
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

  const tagName = el.tagName;
  const isContentEditable = (el as HTMLElement).contentEditable === 'true';

  // Explicitly target Monaco Editor parts
  if (el.classList.contains("native-edit-context")) return true;
  if (el.classList.contains("ime-text-area")) return true;
  if (el.classList.contains("monaco-mouse-cursor-text")) return true;
  if (el.closest('.monaco-editor')) return true;

  // CodeMirror or other common editors
  if (el.classList.contains("CodeMirror-code")) return true;
  if (el.closest('.CodeMirror')) return true;

  if (tagName === "TEXTAREA") return true;
  if (tagName === "INPUT" && (el as HTMLInputElement).type === "text") return true;
  if (isContentEditable) return true;
  
  return false;
};

let isExpanding = false;

// Helper to get text and cursor from any supported element
const getEditorState = (el: HTMLElement): { text: string, cursor: number } => {
  // 1. EditContext (Modern Monaco)
  const ec = (el as any).editContext;
  if (ec) {
    return { text: ec.text, cursor: ec.selectionEnd };
  }

  // 2. Standard Input/Textarea
  if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
    const input = el as HTMLInputElement | HTMLTextAreaElement;
    return { text: input.value, cursor: input.selectionEnd || 0 };
  }

  // 3. ContentEditable
  const sel = window.getSelection();
  let cursor = 0;
  if (sel && sel.rangeCount > 0) {
    cursor = sel.focusOffset;
  }
  return { text: el.innerText || (el as any).value || "", cursor };
};

// Helper to apply replacement
const applyReplacement = (el: HTMLElement, match: any) => {
  const { replacementText, triggerRange, selection } = match;
  const ec = (el as any).editContext;
  
  if (ec) {
    console.log("Prism Macro Debug: Using EditContext.updateText + TextUpdateEvent", triggerRange.start, triggerRange.end, replacementText);
    try {
      // 1. Update the buffer
      ec.updateText(triggerRange.start, triggerRange.end, replacementText);
      ec.updateSelection(selection.start, selection.end);
      
      // 2. Wrap in composition events to force commitment in many editors
      el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      
      // 3. Dispatch the textupdate event which is what the application actually listens to
      // We try to use the specialized TextUpdateEvent if available, otherwise fallback to CustomEvent
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
        // Fallback for environments where the constructor isn't directly exposed
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
        // Manually attach properties if the application expects them on the event object
        Object.assign(event, {
            updateRangeStart: triggerRange.start,
            updateRangeEnd: triggerRange.end,
            text: replacementText,
            selectionStart: selection.start,
            selectionEnd: selection.end
        });
      }
      
      ec.dispatchEvent(event);
      el.dispatchEvent(new CompositionEvent('compositionend', { data: replacementText, bubbles: true }));

      // 4. Also dispatch a generic input event for good measure
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
    // Monaco or generic DIV/ContentEditable
    el.focus();
    
    try {
      // Standard selection-based replacement for ContentEditable
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        // We assume the cursor is at triggerRange.end
        // This is a bit simplified for general ContentEditable but should work for Monaco fallback
        document.execCommand("insertText", false, replacementText);
      }
    } catch (e) {
      console.error("Prism Macro Debug: ContentEditable replacement failed", e);
    }
    return;
  }

  if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
    const input = el as HTMLInputElement | HTMLTextAreaElement;
    const scrollTop = input.scrollTop;
    input.focus();
    
    const val = input.value;
    const newVal = val.slice(0, triggerRange.start) + replacementText + val.slice(triggerRange.end);
    
    // We try to use execCommand first to preserve undo history
    // But since we want surgical, we might need to select the range first
    input.setSelectionRange(triggerRange.start, triggerRange.end);
    const success = document.execCommand("insertText", false, replacementText);
    
    if (!success || input.value !== newVal) {
       input.value = newVal;
    }
    
    input.setSelectionRange(selection.start, selection.end);
    input.scrollTop = scrollTop;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  } else {
    el.innerText = replacementText;
  }
};

const handleMacroExpansion = (el: HTMLElement) => {
  if (isExpanding) return;

  const { text, cursor } = getEditorState(el);
  if (!text) return;

  const match = checkMacroTrigger(text, cursor, macros);
  if (match) {
    console.log(`Prism Macro Debug: Macro Triggered! [${text.slice(match.triggerRange.start, match.triggerRange.end)}] ->`, match.replacementText);
    
    isExpanding = true;
    try {
      applyReplacement(el, match);
    } finally {
      // Use a timeout to ensure all events triggered by replacement are ignored
      setTimeout(() => { isExpanding = false; }, 50);
    }
  }
};

// Main Logic
document.addEventListener("focusin", (e) => {
  const el = e.target as HTMLElement;
  if (el) {
    console.log("Prism Macro Debug: Focus on", el.tagName, "Classes:", el.className, "isEditable:", isEditable(el));
    if ((el as any).editContext) {
      console.log("Prism Macro Debug: EditContext detected");
    }
  }
});

document.addEventListener("keydown", (e) => {
  if (!enabled || isExpanding) return;
  const el = document.activeElement as HTMLElement;
  if (!isEditable(el)) return;

  // Filter out modifiers and navigation keys
  if (["Control", "Alt", "Meta", "Shift", "CapsLock", "Tab", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
    return;
  }

  // Use a small timeout to let the character be inserted first
  setTimeout(() => handleMacroExpansion(el), 10);
}, true);

document.addEventListener("input", (e) => {
  if (!enabled || isExpanding) return;
  const el = e.target as HTMLElement;
  if (!isEditable(el)) return;

  handleMacroExpansion(el);
});

console.log("Prism Text Macros Loaded v0.1.2");
