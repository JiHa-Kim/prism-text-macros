export type MacroBridgeRequest =
  | { type: "PING" }
  | { type: "GET_STATE" }
  | {
      type: "APPLY_EDIT";
      edit: {
        start: number; // absolute offset in full document
        end: number;   // absolute offset in full document
        text: string;  // replacement text
      };
      selection: { start: number; end: number }; // absolute offsets after edit
    }
  | {
      type: "SET_SELECTION";
      selection: { start: number; end: number };
    }
  | {
      type: "SET_MACROS";
      macros: any[];
    }
  | {
      type: "SET_ENABLED";
      enabled: boolean;
    };

export type MacroBridgeResponse =
  | { type: "PONG" }
  | { type: "STATE"; ok: true; text: string; cursor: number }
  | { type: "STATE"; ok: false; reason: string }
  | { type: "APPLY_OK" }
  | { type: "APPLY_FAIL"; reason: string }
  | { type: "SELECTION_OK" }
  | { type: "SELECTION_FAIL"; reason: string };

export const BRIDGE_CHANNEL = "PRISM_MACRO_BRIDGE";
