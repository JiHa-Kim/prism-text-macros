
import { describe, it, expect } from "vitest";
import { checkMacroTrigger } from "../lib/macroEngine";
import { Macro } from "../lib/types";

describe("Macro Options Alignment", () => {
  const macros: Macro[] = [
    { trigger: "t1", replacement: "text", options: "t" },
    { trigger: "m1", replacement: "math", options: "m" },
    { trigger: "M1", replacement: "block", options: "M" },
    { trigger: "n1", replacement: "inline", options: "n" },
    { trigger: "c1", replacement: "code", options: "c" },
    { trigger: "w1", replacement: "word", options: "w" },
    { trigger: "v1", replacement: "visual", options: "v" },
    { trigger: "A1", replacement: "auto", options: "A" },
  ];

  it("should trigger 't' only outside math", () => {
    expect(checkMacroTrigger("t1", 2, macros)).not.toBeNull();
    expect(checkMacroTrigger("$t1$", 3, macros)).toBeNull();
  });

  it("should trigger 'm' only inside math (inline and block)", () => {
    expect(checkMacroTrigger("m1", 2, macros)).toBeNull();
    expect(checkMacroTrigger("$m1", 3, macros)).not.toBeNull();
    expect(checkMacroTrigger("$$m1", 4, macros)).not.toBeNull();
  });

  it("should trigger 'M' only in block math", () => {
    expect(checkMacroTrigger("$M1", 3, macros)).toBeNull();
    expect(checkMacroTrigger("$$M1", 4, macros)).not.toBeNull();
  });

  it("should trigger 'n' only in inline math", () => {
    expect(checkMacroTrigger("$n1", 3, macros)).not.toBeNull();
    expect(checkMacroTrigger("$$n1", 4, macros)).toBeNull();
  });

  it("should trigger 'c' only in code blocks", () => {
    expect(checkMacroTrigger("c1", 2, macros)).toBeNull();
    expect(checkMacroTrigger("```\nc1", 6, macros)).not.toBeNull();
  });

  it("should trigger 'w' only at word boundaries", () => {
    expect(checkMacroTrigger(" w1", 3, macros)).not.toBeNull();
    expect(checkMacroTrigger("aw1", 3, macros)).toBeNull();
    // followed by delimiter
    expect(checkMacroTrigger("w1a", 2, macros)).toBeNull();
  });

  it("should trigger 'v' only on selection with single char trigger", () => {
    const vMacro: Macro = { trigger: "v", replacement: "x", options: "v" };
    expect(checkMacroTrigger("v", 1, [vMacro], false, false, "selection")).not.toBeNull();
    expect(checkMacroTrigger("v", 1, [vMacro], false, false, "")).toBeNull();
    
    const multiCharV: Macro = { trigger: "vv", replacement: "x", options: "v" };
    expect(checkMacroTrigger("vv", 2, [multiCharV], false, false, "selection")).toBeNull();
  });

  it("should handle 'v' with single character as trigger as per spec", () => {
    const macrosV: Macro[] = [
        { trigger: "R", replacement: "\\textcolor{red}{${VISUAL}}", options: "mv" }
    ];
    // selection "foo", type "R"
    // text: "$fooR", cursor at 5, visualContent "foo"
    expect(checkMacroTrigger("$fooR", 5, macrosV, false, false, "foo")).not.toBeNull();
  });
});
