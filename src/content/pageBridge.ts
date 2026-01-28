import {
  BRIDGE_CHANNEL,
  MacroBridgeRequest,
  MacroBridgeResponse,
  BridgeMacro,
} from "../lib/protocol";
import type { Macro, TabStop } from "../lib/types";
import { checkMacroTrigger } from "../lib/macroEngine";
import { expandMacros } from "../lib/macroUtils";
import { defaultSnippets } from "../lib/defaultSnippets";

type Monaco = any;

function post(resp: MacroBridgeResponse) {
  window.postMessage({ channel: BRIDGE_CHANNEL, payload: resp }, "*");
}

function getMonaco(): Monaco | null {
  const w = globalThis as any;
  if (w.monaco?.editor) return w.monaco;


  const req = w.require;
  if (typeof req === "function") {
    // Some sites use require to get monaco
    try {
      // If monaco is already defined via require
      const m = req("vs/editor/editor.main");
      if (m?.editor) return m;
    } catch {}
  }
  
  return null;
}

function pickActiveEditor(monaco: Monaco) {
  const editorApi = monaco.editor;
  const editors: any[] = typeof editorApi.getEditors === "function" ? editorApi.getEditors() : [];
  if (!editors.length) return null;

  for (const ed of editors) {
    try {
      if (typeof ed.hasTextFocus === "function" && ed.hasTextFocus()) return ed;
    } catch {}
  }
  return editors[0];
}

// Function registry inside the page context (Monaco path)
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

function hydrateBridgeMacros(inMacros: BridgeMacro[]): Macro[] {
  return expandMacros(
    inMacros.map((m) => {
      const trigger = m.triggerIsRegex
        ? new RegExp(m.trigger, m.triggerFlags || "")
        : m.trigger;

      const replacement =
        m.isFunc && m.jsName && functionRegistry[m.jsName]
          ? functionRegistry[m.jsName]
          : (m.replacement ?? "");

      return {
        id: m.id,
        trigger,
        replacement,
        options: m.options,
        description: m.description,
        priority: m.priority,
        jsName: m.jsName,
      } satisfies Macro;
    })
  );
}

// Monaco-side state
let enabled = true;
let macros: Macro[] = expandMacros(defaultSnippets);

const attachedEditors = new WeakSet<any>();
const pendingModelEditors = new WeakSet<any>();

const lastCursorOffsetByEditor = new WeakMap<any, number>();

const applyingByEditor = new WeakMap<any, boolean>();
const scheduledByEditor = new WeakMap<any, boolean>();
const scheduledVersionByEditor = new WeakMap<any, number>();

type ActiveMacroState = {
  stops: TabStop[]; // absolute offsets
  idx: number;      // current stop index (0-based)
};
const activeMacroByEditor = new WeakMap<any, ActiveMacroState | null>();

function getCursorOffset(ed: any, model: any) {
  const sel = ed.getSelection?.();
  if (!sel) return 0;
  return model.getOffsetAt(sel.getEndPosition());
}

function setSelectionByOffsets(ed: any, model: any, monaco: any, start: number, end: number) {
  const sPos = model.getPositionAt(start);
  const ePos = model.getPositionAt(end);
  ed.setSelection(
    new monaco.Selection(sPos.lineNumber, sPos.column, ePos.lineNumber, ePos.column)
  );
  ed.focus();
}

function attachEditor(ed: any, monaco: any) {
  if (!ed || attachedEditors.has(ed)) return;

  const model = ed.getModel?.();
  if (!model) {
    if (!pendingModelEditors.has(ed)) {
      pendingModelEditors.add(ed);
      ed.onDidChangeModel?.(() => {
        if (ed.getModel()) {
          attachEditor(ed, monaco);
        }
      });
    }
    return;
  }

  attachedEditors.add(ed);

  lastCursorOffsetByEditor.set(ed, getCursorOffset(ed, model));
  activeMacroByEditor.set(ed, null);

  // Track cursor changes
  ed.onDidChangeCursorSelection?.(() => {
    const m = ed.getModel?.();
    if (!m) return;
    lastCursorOffsetByEditor.set(ed, getCursorOffset(ed, m));
  });

  // IME composition handling via textarea
  let inComposition = false;
  try {
    const ta = ed.getDomNode?.()?.querySelector("textarea");
    if (ta) {
      ta.addEventListener("compositionstart", () => {
        inComposition = true;
      });
      ta.addEventListener("compositionend", () => {
        inComposition = false;
      });
    }
  } catch {}

  // Install Tab / Shift+Tab commands for tabstops
  // REMOVED: Monaco snippet controller handles Tab now.
  // try {
  //   const runTab = (dir: 1 | -1) => { ... }
  // } catch { ... }

  // Main expansion loop
  ed.onDidChangeModelContent?.(() => {
    if (!enabled) return;
    if (applyingByEditor.get(ed)) return;
    if (inComposition) return;

    const m = ed.getModel?.();
    if (!m) return;

    lastCursorOffsetByEditor.set(ed, getCursorOffset(ed, m));

    if (scheduledByEditor.get(ed)) return;
    scheduledByEditor.set(ed, true);

    const version = m.getVersionId?.() ?? 0;
    scheduledVersionByEditor.set(ed, version);

    queueMicrotask(() => {
      scheduledByEditor.set(ed, false);

      const mm = ed.getModel?.();
      if (!mm) return;

      const vNow = mm.getVersionId?.() ?? 0;
      const vScheduled = scheduledVersionByEditor.get(ed) ?? 0;
      if (vNow !== vScheduled) return;

      // CRITICAL: Get cursor offset INSIDE the microtask to ensure it's up to date
      // after the character has been inserted into the model.
      const cursor = getCursorOffset(ed, mm);
      const text = mm.getValue(); 
      
      const match = checkMacroTrigger(text, cursor, macros);
      if (!match) return;

      applyingByEditor.set(ed, true);
      try {
        const startPos = mm.getPositionAt(match.triggerRange.start);
        const endPos = mm.getPositionAt(match.triggerRange.end);

        const range = new monaco.Range(
          startPos.lineNumber,
          startPos.column,
          endPos.lineNumber,
          endPos.column
        );

        // Select the trigger range, then insert a Monaco snippet so Monaco owns tabstops
        // Insert snippet (Monaco handles tabstops + suggest/Tab compat)
        try {
          const controller = ed.getContribution("snippetController2");
          if (controller && typeof controller.insert === 'function') {
            const overwriteBefore = match.triggerRange.end - match.triggerRange.start;
            controller.insert(match.snippetText, { overwriteBefore: overwriteBefore, overwriteAfter: 0 });
          } else {
             throw new Error("Snippet controller not found");
          }
        } catch (e) {
          console.warn("Prism Macro: Snippet insertion failed, falling back to basic replacement", e);
          // Fallback if insertSnippet is unavailable
          ed.executeEdits("prism-macro", [{ range, text: match.replacementText, forceMoveMarkers: true }]);
          setSelectionByOffsets(ed, mm, monaco, match.selection.start, match.selection.end);
        }

        // IMPORTANT: do not set activeMacroByEditor here anymore.
        // Let Monaco manage snippet placeholders and Tab.
        activeMacroByEditor.set(ed, null);

      } finally {
        applyingByEditor.set(ed, false);
      }
    });
  });
}

function attachToAllEditors(monaco: any) {
  const editorApi = monaco.editor;

  // Existing editors
  try {
    const editors: any[] = typeof editorApi.getEditors === "function" ? editorApi.getEditors() : [];
    for (const ed of editors) attachEditor(ed, monaco);
  } catch (e) {
    console.warn("Prism Macro (Monaco) Debug: Error getting editors", e);
  }

  // Future editors
  try {
    editorApi.onDidCreateEditor?.((ed: any) => {
      attachEditor(ed, monaco);
    });
  } catch (e) {
    console.warn("Prism Macro (Monaco) Debug: Error setting up onDidCreateEditor", e);
  }
}

function handleSetConfig(req: Extract<MacroBridgeRequest, { type: "SET_CONFIG" }>) {
  try {
    enabled = !!req.enabled;
    macros = hydrateBridgeMacros(req.macros || []);

    const monaco = getMonaco();
    if (monaco) attachToAllEditors(monaco);

    post({ type: "CONFIG_OK" });
  } catch (e: any) {
    post({ type: "CONFIG_FAIL", reason: String(e?.message || e) });
  }
}

function handleSetSelection(req: Extract<MacroBridgeRequest, { type: "SET_SELECTION" }>) {
  const monaco = getMonaco();
  if (!monaco) {
    post({ type: "SELECTION_FAIL", reason: "window.monaco not found" });
    return;
  }

  const ed = pickActiveEditor(monaco);
  if (!ed) {
    post({ type: "SELECTION_FAIL", reason: "No monaco editor instance" });
    return;
  }

  const model = ed.getModel?.();
  if (!model) {
    post({ type: "SELECTION_FAIL", reason: "No model on editor" });
    return;
  }

  try {
    setSelectionByOffsets(ed, model, monaco, req.selection.start, req.selection.end);
    post({ type: "SELECTION_OK" });
  } catch (e: any) {
    post({ type: "SELECTION_FAIL", reason: String(e?.message || e) });
  }
}

window.addEventListener("message", (evt: MessageEvent) => {
  const data = evt.data as any;
  if (!data || data.channel !== BRIDGE_CHANNEL) return;

  const req = data.payload as MacroBridgeRequest;
  if (!req || typeof req.type !== "string") return;

  if (req.type === "PING") {
    post({ type: "PONG" });
    return;
  }

  if (req.type === "SET_CONFIG") {
    handleSetConfig(req);
    return;
  }

  if (req.type === "SET_SELECTION") {
    handleSetSelection(req);
    return;
  }
});

// Polling for Monaco if it's not immediately present
const tryAttach = () => {
  try {
    const monaco = getMonaco();
    if (monaco) {
      attachToAllEditors(monaco);
      return true;
    }
  } catch {}
  return false;
};

if (!tryAttach()) {
  let attempts = 0;
  const interval = setInterval(() => {
    attempts++;
    if (tryAttach()) {
      clearInterval(interval);
    } else if (attempts > 40) {
      clearInterval(interval);
    }
  }, 500);
}

console.log("Prism Macro Page Bridge Loaded v0.3.0 (Monaco-native expansion)");
