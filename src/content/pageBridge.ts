import { BRIDGE_CHANNEL, MacroBridgeRequest, MacroBridgeResponse } from "../lib/protocol";
import { checkMacroTrigger, hydrateMacros } from "../lib/macroEngine";
import { Macro } from "../lib/types";

type Monaco = any;

let enabled = true;
let macros: Macro[] = [];

let applying = false;
let inComposition = false;
let activeMacro: { tabStops: any[], currentStopIndex: number } | null = null;

// We use a Set to keep track of attached editors
const attachedEditors = new Set<any>();

function post(resp: MacroBridgeResponse) {
  window.postMessage({ channel: BRIDGE_CHANNEL, payload: resp }, "*");
}

function getMonaco(): Monaco | null {
  const w = globalThis as any;
  if (w.monaco?.editor) return w.monaco;

  const req = w.require;
  if (typeof req === "function") {
    try {
      req(["vs/editor/editor.main"], () => {});
    } catch {}
  }

  return w.monaco?.editor ? w.monaco : null;
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

function handleTabStop(ed: any, monaco: Monaco, shiftKey: boolean): boolean {
  if (!activeMacro || activeMacro.tabStops.length === 0) return false;

  const direction = shiftKey ? -1 : 1;
  let nextIndex = activeMacro.currentStopIndex + direction;

  if (nextIndex >= activeMacro.tabStops.length) {
    activeMacro = null;
    return false;
  }
  if (nextIndex < 0) nextIndex = 0;

  const nextStop = activeMacro.tabStops[nextIndex];
  activeMacro.currentStopIndex = nextIndex;

  const model = ed.getModel();
  const sPos = model.getPositionAt(nextStop.start);
  const ePos = model.getPositionAt(nextStop.end);
  ed.setSelection(new monaco.Selection(sPos.lineNumber, sPos.column, ePos.lineNumber, ePos.column));
  ed.focus();
  return true;
}

function attachToEditor(ed: any, monaco: Monaco) {
  if (attachedEditors.has(ed)) return;
  attachedEditors.add(ed);

  const model = ed.getModel();
  if (!model) return;

  let lastCursorOffset = 0;
  let scheduled = false;
  let scheduledVersionId = 0;

  const updateCursor = () => {
    const sel = ed.getSelection?.();
    if (!sel) return;
    lastCursorOffset = model.getOffsetAt(sel.getEndPosition());
  };

  ed.onDidChangeCursorSelection(() => {
    updateCursor();
  });

  ed.onKeyDown((e: any) => {
    if (e.keyCode === monaco.KeyCode.Tab) {
      if (handleTabStop(ed, monaco, e.shiftKey)) {
        e.preventDefault();
        e.stopPropagation();
      }
    }
  });

  ed.onDidChangeModelContent((e: any) => {
    if (!enabled || applying || inComposition) return;

    updateCursor();

    if (scheduled) return;
    scheduled = true;
    scheduledVersionId = model.getVersionId();

    queueMicrotask(() => {
      scheduled = false;
      if (model.getVersionId() !== scheduledVersionId) return;

      const eolPref = monaco.editor?.EndOfLinePreference?.LF ?? 1;
      let text = model.getValue(eolPref);
      const cursor = lastCursorOffset;

      const match = checkMacroTrigger(text, cursor, macros);
      if (!match) return;

      applying = true;
      try {
        const startPos = model.getPositionAt(match.triggerRange.start);
        const endPos = model.getPositionAt(match.triggerRange.end);
        const range = new monaco.Range(
          startPos.lineNumber, startPos.column,
          endPos.lineNumber, endPos.column
        );

        ed.executeEdits("prism-macro", [{ range, text: match.replacementText, forceMoveMarkers: true }]);

        activeMacro = {
          tabStops: match.tabStops || [],
          currentStopIndex: -1
        };

        const sPos = model.getPositionAt(match.selection.start);
        const ePos = model.getPositionAt(match.selection.end);
        ed.setSelection(new monaco.Selection(
          sPos.lineNumber, sPos.column,
          ePos.lineNumber, ePos.column
        ));
      } finally {
        applying = false;
      }
    });
  });

  // Handle composition via textarea
  const domNode = ed.getDomNode?.();
  const textarea = domNode?.querySelector("textarea");
  if (textarea) {
    textarea.addEventListener("compositionstart", () => { inComposition = true; });
    textarea.addEventListener("compositionend", () => { inComposition = false; });
  }

  ed.onDidDispose(() => {
    attachedEditors.delete(ed);
  });
}

function initMonacoIntegration() {
  const monaco = getMonaco();
  if (!monaco) {
    // Retry periodically if not found yet (some sites load it late)
    setTimeout(initMonacoIntegration, 1000);
    return;
  }

  // Attach to existing editors
  const editors = monaco.editor.getEditors?.() || [];
  for (const ed of editors) {
    attachToEditor(ed, monaco);
  }

  // Listen for new editors
  monaco.editor.onDidCreateEditor((ed: any) => {
    attachToEditor(ed, monaco);
  });
}

function handleGetState() {
  const monaco = getMonaco();
  if (!monaco) { post({ type: "STATE", ok: false, reason: "Monaco not found" }); return; }

  const ed = pickActiveEditor(monaco);
  if (!ed) { post({ type: "STATE", ok: false, reason: "No editor" }); return; }

  const model = ed.getModel?.();
  if (!model) { post({ type: "STATE", ok: false, reason: "No model" }); return; }

  const eolPref = monaco.editor?.EndOfLinePreference?.LF ?? 1;
  const text = model.getValue(eolPref);
  const sel = ed.getSelection?.();
  const cursor = sel ? model.getOffsetAt(sel.getEndPosition()) : 0;

  post({ type: "STATE", ok: true, text, cursor });
}

function handleApplyEdit(req: Extract<MacroBridgeRequest, { type: "APPLY_EDIT" }>) {
  const monaco = getMonaco();
  if (!monaco) { post({ type: "APPLY_FAIL", reason: "Monaco not found" }); return; }

  const ed = pickActiveEditor(monaco);
  if (!ed) { post({ type: "APPLY_FAIL", reason: "No editor" }); return; }

  const model = ed.getModel?.();
  if (!model) { post({ type: "APPLY_FAIL", reason: "No model" }); return; }

  applying = true;
  try {
    const { start, end, text } = req.edit;
    const startPos = model.getPositionAt(start);
    const endPos = model.getPositionAt(end);
    const range = new monaco.Range(startPos.lineNumber, startPos.column, endPos.lineNumber, endPos.column);

    ed.executeEdits("prism-macro", [{ range, text, forceMoveMarkers: true }]);

    const sPos = model.getPositionAt(req.selection.start);
    const ePos = model.getPositionAt(req.selection.end);
    ed.setSelection(new monaco.Selection(sPos.lineNumber, sPos.column, ePos.lineNumber, ePos.column));
    ed.focus();

    post({ type: "APPLY_OK" });
  } catch (e: any) {
    post({ type: "APPLY_FAIL", reason: String(e.message || e) });
  } finally {
    applying = false;
  }
}

function handleSetSelection(req: Extract<MacroBridgeRequest, { type: "SET_SELECTION" }>) {
  const monaco = getMonaco();
  if (!monaco) return;

  const ed = pickActiveEditor(monaco);
  if (!ed) return;

  const model = ed.getModel?.();
  if (!model) return;

  const sPos = model.getPositionAt(req.selection.start);
  const ePos = model.getPositionAt(req.selection.end);
  ed.setSelection(new monaco.Selection(sPos.lineNumber, sPos.column, ePos.lineNumber, ePos.column));
  ed.focus();
}

window.addEventListener("message", (evt: MessageEvent) => {
  const data = evt.data as any;
  if (!data || data.channel !== BRIDGE_CHANNEL) return;

  const req = data.payload as MacroBridgeRequest;
  if (!req || typeof req.type !== "string") return;

  if (req.type === "PING") post({ type: "PONG" });
  if (req.type === "GET_STATE") handleGetState();
  if (req.type === "APPLY_EDIT") handleApplyEdit(req);
  if (req.type === "SET_SELECTION") handleSetSelection(req);
  if (req.type === "SET_ENABLED") enabled = req.enabled;
  if (req.type === "SET_MACROS") {
    macros = hydrateMacros(req.macros);
  }
});

initMonacoIntegration();
console.log("Prism Macro Page Bridge v2 (Native Monaco) Loaded");
