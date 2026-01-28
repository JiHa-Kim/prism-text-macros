import { MacroMatch } from '../lib/macroEngine';
import { TabStop } from '../lib/types';

export interface ActiveMacroState {
    tabStops: TabStop[];         // ABSOLUTE offsets in the editor text
    currentStopIndex: number;
}

export const isEditable = (el: Element | null): boolean => {
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

export const getFallbackEditorState = (el: HTMLElement): { text: string, cursor: number } => {
  const ec = (el as any).editContext;
  if (ec) return { text: ec.text, cursor: ec.selectionEnd };

  if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
    const input = el as HTMLInputElement | HTMLTextAreaElement;
    return { text: input.value, cursor: input.selectionEnd || 0 };
  }

  const sel = window.getSelection();
  let cursor = 0;
  if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      const preCaretRange = range.cloneRange();
      preCaretRange.selectNodeContents(el);
      preCaretRange.setEnd(range.endContainer, range.endOffset);
      cursor = preCaretRange.toString().length;
  }
  
  return { text: el.innerText || (el as any).value || "", cursor };
};

export const applyFallbackReplacement = (el: HTMLElement, match: MacroMatch): ActiveMacroState | null => {
  const { replacementText, triggerRange, selection, tabStops } = match;
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

      return {
          tabStops: tabStops || [],
          currentStopIndex: -1
      };
    } catch (e) {
      console.error("Prism Macro Debug: EditContext replacement failed", e);
    }
  }

  if (el.tagName === "DIV" || (el as HTMLElement).contentEditable === 'true') {
    el.focus();
    const sel = window.getSelection();
    if (sel) {
        const triggerLen = triggerRange.end - triggerRange.start;
        for (let i = 0; i < triggerLen; i++) {
           sel.modify('extend', 'backward', 'character');
        }
    }

    try {
      document.execCommand("insertText", false, replacementText);
    } catch (e) {
      console.error("Prism Macro Debug: ContentEditable replacement failed", e);
    }
    
    return {
        tabStops: tabStops || [],
        currentStopIndex: -1
    };
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

    return {
        tabStops: tabStops || [],
        currentStopIndex: -1
    };
  } else {
    el.innerText = replacementText;
    return null;
  }
};

export const showExpansionFeedback = (el: HTMLElement, start: number, length: number) => {
    el.classList.add('macro-expanding');
    setTimeout(() => el.classList.remove('macro-expanding'), 300);
};

export const injectFeedbackStyles = () => {
    const style = document.createElement('style');
    style.textContent = 
        ".macro-expanding {" +
        "    transition: box-shadow 0.2s ease-out;" +
        "    box-shadow: 0 0 8px rgba(92, 107, 192, 0.4) !important;" +
        "}";
    document.head.appendChild(style);
};


export const setContentEditableSelection = (root: HTMLElement, start: number, end: number): boolean => {
  const doc = root.ownerDocument;
  const win = doc.defaultView;
  if (!win) return false;

  const sel = win.getSelection();
  if (!sel) return false;

  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node: Node | null = walker.nextNode();
  let pos = 0;

  let startNode: Text | null = null;
  let startOffset = 0;
  let endNode: Text | null = null;
  let endOffset = 0;

  while (node) {
    const textNode = node as Text;
    const len = textNode.data.length;

    if (!startNode && start <= pos + len) {
      startNode = textNode;
      startOffset = Math.max(0, start - pos);
    }
    if (!endNode && end <= pos + len) {
      endNode = textNode;
      endOffset = Math.max(0, end - pos);
      break;
    }

    pos += len;
    node = walker.nextNode();
  }

  if (!startNode || !endNode) return false;

  const range = doc.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);

  sel.removeAllRanges();
  sel.addRange(range);
  return true;
};
