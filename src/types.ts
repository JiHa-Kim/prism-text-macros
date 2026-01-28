
export interface Macro {
  id?: string; // Optional because parsed snippets might not have IDs initially
  trigger: string | RegExp;
  replacement: string | ((match: string[]) => string);
  options?: string; // e.g., "mA", "rmA", "tA"
  description?: string;
  priority?: number;
}

export interface EditorState {
  content: string;
  cursorPosition: number;
}

export type EditorAction =
  | 'UNDO'
  | 'REDO'
  | 'DELETE_WORD'
  | 'DELETE_LINE'
  | 'MOVE_LINE_UP'
  | 'MOVE_LINE_DOWN'
  | 'SMART_FRACTION'
  | 'INDENT'
  | 'NEXT_TABSTOP';

export interface KeyBinding {
  id: string;
  keys: string; // e.g. "Ctrl+k", "Alt+Up"
  action: EditorAction;
}