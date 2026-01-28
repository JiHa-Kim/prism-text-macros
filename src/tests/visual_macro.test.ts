
import { describe, it, expect } from "vitest";
import { checkMacroTrigger } from "../lib/macroEngine";
import { Macro } from "../lib/types";

describe("Visual Macro Expansion", () => {
  const macros: Macro[] = [
    {
      trigger: "R",
      replacement: "\\textcolor{red}{${VISUAL}}$0",
      options: "mA", // math mode, auto
    },
  ];

  it("should trigger visual macro when visual content is provided", () => {
    // text ends with "R", cursor is after "R"
    // matching rules normally might filter it out if checkMacroTrigger filters VISUAL macros
    const text = "some text R";
    const cursor = text.length;
    const visualContent = "highlighted";

    // Currently checkMacroTrigger doesn't accept visualContent so this call is illustrative of what we want
    // We expect to modify checkMacroTrigger to take visualContent
    // @ts-ignore
    const match = checkMacroTrigger(text, cursor, macros, true, true, visualContent);

    expect(match).not.toBeNull();
    if (match) {
        expect(match.replacementText).toBe("\\textcolor{red}{highlighted}");
    }
  });

  it("should NOT trigger visual macro when NO visual content is provided", () => {
    const text = "some text R";
    const cursor = text.length;
    const visualContent = "";

    // @ts-ignore
    const match = checkMacroTrigger(text, cursor, macros, true, true, visualContent);

    expect(match).toBeNull();
  });


  it("should trigger visual macro when visual content is provided inside inline math", () => {
    
    const text = "some $xR";
    const cursor = text.length;
    const visualContent = "x";

    // @ts-ignore
    const match = checkMacroTrigger(text, cursor, macros, false, true, visualContent);

    expect(match).not.toBeNull();
    if (match) {
        expect(match.replacementText).toBe("\\textcolor{red}{x}");
    }
  });
});
