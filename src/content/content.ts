// content/content.ts
import { Macro } from '../lib/types';
import { checkMacroTrigger, hydrateMacros } from '../lib/macroEngine';
import { expandMacros, prepareForStorage } from '../lib/macroUtils';
import { defaultSnippets } from '../lib/defaultSnippets';
import { loadMacrosFromStorage } from '../lib/storage';
import {
  injectBridgeScript,
  getStateFromBridge,
  applyEditViaBridge,
  setSelectionViaBridge,
  syncWithBridge
} from './bridge';
import {
  isEditable,
  getFallbackEditorState,
  applyFallbackReplacement,
  showExpansionFeedback,
  injectFeedbackStyles,
  ActiveMacroState,
  setContentEditableSelection
} from './handlers';

// State
let enabled = true;
let macros: Macro[] = hydrateMacros(expandMacros(defaultSnippets));

// Tabstop State
let activeMacro: ActiveMacroState | null = null;

// Load initial state
const init = async () => {
  try {
    const raw = await loadMacrosFromStorage(chrome.storage.local);
    macros = hydrateMacros(raw);
    syncWithBridge(prepareForStorage(macros), enabled);
  } catch (e) {
    console.error('Prism Macros: Error loading macros', e);
    // Fallback sync
    syncWithBridge(prepareForStorage(macros), enabled);
  }
};

init();

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'TOGGLE_STATE') {
    enabled = msg.enabled;
    syncWithBridge(prepareForStorage(macros), enabled);
  }
});

let isExpanding = false;

// Prevent concurrent expansions (race between keydown/input + async bridge reads)
let expansionInFlight = false;

// Heuristic: Monaco/editor surfaces where DOM "input" may also fire or be weird.
// We will run macro expansion from keydown only for these.
const isMonacoLikeElement = (el: HTMLElement): boolean => {
  if (!el) return false;
  if (el.classList.contains('native-edit-context')) return true;
  if (el.classList.contains('ime-text-area')) return true;
  if (el.classList.contains('monaco-mouse-cursor-text')) return true;
  if (el.closest('.monaco-editor')) return true;
  return false;
};

const handleMacroExpansion = async (el: HTMLElement) => {
  if (!enabled) return;

  // Hard lock against concurrent async expansions.
  // Must be set BEFORE any awaits, otherwise two invocations can race.
  if (expansionInFlight) return;
  expansionInFlight = true;

  try {
    // If we are already applying an edit, skip.
    // (This is separate from expansionInFlight: isExpanding is "we are mutating editor now".)
    if (isExpanding) return;

    // 1) Try Bridge
    const bridgeState = await getStateFromBridge();
    let text = '';
    let cursor = 0;
    let useBridge = false;

    if (bridgeState.ok) {
      text = bridgeState.text;
      cursor = bridgeState.cursor;
      useBridge = true;
    } else {
      // 2) Fallback
      const fallback = getFallbackEditorState(el);
      text = fallback.text;
      cursor = fallback.cursor;
    }

    if (!text) return;

    const match = checkMacroTrigger(text, cursor, macros);
    if (!match) return;

    console.log(
      `Prism Macro Debug: Macro Triggered! [${text.slice(
        match.triggerRange.start,
        match.triggerRange.end
      )}] ->`,
      match.replacementText
    );

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
          console.warn('Prism Macro Debug: Bridge apply failed, falling back', res.reason);
          const newState = applyFallbackReplacement(el, match);
          if (newState) activeMacro = newState;
        } else {
          // Bridge case: tab stop state is valid
          activeMacro = {
            tabStops: match.tabStops || [],
            currentStopIndex: -1
          };
        }
      } else {
        const newState = applyFallbackReplacement(el, match);
        if (newState) activeMacro = newState;
      }
    } finally {
      // Small cooldown helps avoid immediate re-entry from follow-on events
      // triggered by the edit itself.
      window.setTimeout(() => {
        isExpanding = false;
      }, 30);
    }
  } finally {
    // Release the lock after a tick, so an "input" fired by our own edit
    // does not re-enter immediately with stale state.
    window.setTimeout(() => {
      expansionInFlight = false;
    }, 0);
  }
};

injectBridgeScript();
injectFeedbackStyles();

document.addEventListener('focusin', (e) => {
  const el = e.target as HTMLElement;
  if (el && isEditable(el)) {
    console.log('Prism Macro Debug: Focus on', el.tagName);
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
    return false;
  }
  if (nextIndex < 0) {
    nextIndex = 0;
  }

  const nextStop = activeMacro.tabStops[nextIndex];
  activeMacro.currentStopIndex = nextIndex;

  const absStart = nextStop.start;
  const absEnd = nextStop.end;

  // 1) Try Monaco via bridge (fire-and-forget)
  setSelectionViaBridge({ start: absStart, end: absEnd });

  // Select the tab stop
  if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
    const input = el as HTMLInputElement | HTMLTextAreaElement;
    input.setSelectionRange(absStart, absEnd);
  } else if (el.tagName === 'DIV' || (el as HTMLElement).contentEditable === 'true') {
    setContentEditableSelection(el, absStart, absEnd);
  }

  // Prevent inserting a literal tab
  e.preventDefault();
  e.stopImmediatePropagation();
  return true;
};

document.addEventListener(
  'keydown',
  (e) => {
    if (!enabled) return;

    const el = document.activeElement as HTMLElement;
    if (!isEditable(el)) return;

    if (e.key === 'Tab') {
      if (handleTabKey(e, el)) return;
    }

    if (
      [
        'Control',
        'Alt',
        'Meta',
        'Shift',
        'CapsLock',
        'ArrowLeft',
        'ArrowRight',
        'ArrowUp',
        'ArrowDown',
        'Backspace',
        'Delete'
      ].includes(e.key)
    ) {
      return;
    }

    if (isExpanding || expansionInFlight) return;
    if (isMonacoLikeElement(el)) return;

    // Normal input cooling down and handling
    window.setTimeout(() => handleMacroExpansion(el), 10);
  },
  true
);

document.addEventListener('input', (e) => {
  if (!enabled || isExpanding || expansionInFlight) return;

  const el = e.target as HTMLElement;
  if (!isEditable(el)) return;

  // IMPORTANT: Monaco-like editors are handled by keydown path.
  // Avoid double-trigger here.
  if (isMonacoLikeElement(el)) return;

  handleMacroExpansion(el);
});

console.log('Prism Text Macros Loaded v0.2.2 (Refactored)');
