import { BRIDGE_CHANNEL, MacroBridgeRequest, MacroBridgeResponse } from "./protocol";

type Monaco = any; // We'll cast as needed to avoid heavy type dependencies if they aren't available

function post(resp: MacroBridgeResponse) {
  window.postMessage({ channel: BRIDGE_CHANNEL, payload: resp }, "*");
}

function getMonaco(): Monaco | null {
  const w = globalThis as any;

  // Most common: monaco is already on window
  if (w.monaco?.editor) return w.monaco;

  // Some builds expose AMD require; try to load editor.main to populate window.monaco
  const req = w.require;
  if (typeof req === "function") {
    try {
      req(["vs/editor/editor.main"], () => {});
    } catch {
      // ignore
    }
  }

  return w.monaco?.editor ? w.monaco : null;
}

function pickActiveEditor(monaco: Monaco) {
  const editorApi = monaco.editor;
  const editors: any[] = typeof editorApi.getEditors === "function" ? editorApi.getEditors() : [];
  if (!editors.length) return null;

  // Prefer focused editor
  for (const ed of editors) {
    try {
      if (typeof ed.hasTextFocus === "function" && ed.hasTextFocus()) return ed;
    } catch {}
  }
  // Fallback: first editor
  return editors[0];
}

function handleGetState() {
  const monaco = getMonaco();
  if (!monaco) {
    post({ type: "STATE", ok: false, reason: "window.monaco not found" });
    return;
  }

  const ed = pickActiveEditor(monaco);
  if (!ed) {
    post({ type: "STATE", ok: false, reason: "No monaco editor instance" });
    return;
  }

  const model = ed.getModel?.();
  if (!model) {
    post({ type: "STATE", ok: false, reason: "No model on editor" });
    return;
  }

  const text: string = model.getValue();
  const sel = ed.getSelection?.();
  if (!sel) {
    post({ type: "STATE", ok: false, reason: "No selection" });
    return;
  }

  // Use end position as cursor
  const cursor = model.getOffsetAt(sel.getEndPosition());

  post({ type: "STATE", ok: true, text, cursor });
}

function handleApplyEdit(req: Extract<MacroBridgeRequest, { type: "APPLY_EDIT" }>) {
  const monaco = getMonaco();
  if (!monaco) {
    post({ type: "APPLY_FAIL", reason: "window.monaco not found" });
    return;
  }

  const ed = pickActiveEditor(monaco);
  if (!ed) {
    post({ type: "APPLY_FAIL", reason: "No monaco editor instance" });
    return;
  }

  const model = ed.getModel?.();
  if (!model) {
    post({ type: "APPLY_FAIL", reason: "No model on editor" });
    return;
  }

  const { start, end, text } = req.edit;

  const startPos = model.getPositionAt(start);
  const endPos = model.getPositionAt(end);

  const range = new monaco.Range(
    startPos.lineNumber,
    startPos.column,
    endPos.lineNumber,
    endPos.column
  );

  try {
    // executeEdits keeps undo stack
    ed.executeEdits("prism-macro", [{ range, text, forceMoveMarkers: true }]);

    // Update selection after edit
    const sPos = model.getPositionAt(req.selection.start);
    const ePos = model.getPositionAt(req.selection.end);
    const selection = new monaco.Selection(
      sPos.lineNumber,
      sPos.column,
      ePos.lineNumber,
      ePos.column
    );
    ed.setSelection(selection);
    ed.focus();

    post({ type: "APPLY_OK" });
  } catch (e: any) {
    post({ type: "APPLY_FAIL", reason: String(e?.message || e) });
  }
}

window.addEventListener("message", (evt: MessageEvent) => {
  const data = evt.data as any;
  if (!data || data.channel !== BRIDGE_CHANNEL) return;

  const req = data.payload as MacroBridgeRequest;
  if (!req || typeof req.type !== "string") return;

  if (req.type === "PING") post({ type: "PONG" });
  if (req.type === "GET_STATE") handleGetState();
  if (req.type === "APPLY_EDIT") handleApplyEdit(req);
});

console.log("Prism Macro Page Bridge Loaded");
