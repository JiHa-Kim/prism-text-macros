import { checkMacroTrigger } from '../lib/macroEngine';
import { defaultSnippets } from '../lib/defaultSnippets';
import { expandMacros } from '../lib/macroUtils';

const macros = expandMacros(defaultSnippets);

interface TestCase {
  name: string;
  text: string;
  cursor: number;
  shouldMatch: boolean;
  expectedReplacement?: string;
  expectedSelectionStartOffset?: number; // relative to the START of the replacement
}

const tests: TestCase[] = [
  // --- Existing Logic Tests ---
  {
    name: "Currency symbol should not trigger math macro",
    text: "Price: $100. binom",
    cursor: "Price: $100. binom".length,
    shouldMatch: false
  },
  {
    name: "Inline math ($) should trigger math macro",
    text: "$x+y binom",
    cursor: "$x+y binom".length,
    shouldMatch: true,
  },
  {
    name: "Modern inline delimiter (\\() should trigger math macro",
    text: "\\( x+y binom",
    cursor: "\\( x+y binom".length,
    shouldMatch: true
  },
  {
    name: "Modern display delimiter (\\[) should trigger math macro",
    text: "\\[ binom",
    cursor: "\\[ binom".length,
    shouldMatch: true
  },
  {
    name: "Display math ($$) should trigger math macro",
    text: "$$ binom",
    cursor: "$$ binom".length,
    shouldMatch: true
  },
  {
    name: "LaTeX environment should trigger math macro",
    text: "\\begin{equation} binom",
    cursor: "\\begin{equation} binom".length,
    shouldMatch: true
  },
  {
    name: "Multi-line with unbalanced $ should not trigger math macro",
    text: "$x+y\nbinom",
    cursor: "$x+y\nbinom".length,
    shouldMatch: false
  },
  {
    name: "Shell context should not trigger",
    text: "export PATH=$HOME/bin; ->",
    cursor: "export PATH=$HOME/bin; ->".length,
    shouldMatch: false
  },
  {
    name: "Text in math should not trigger",
    text: "$\\text{The binom coefficient}$",
    cursor: "$\\text{The binom".length,
    shouldMatch: false
  },
  {
    name: "Normal math after text in math should trigger",
    text: "$\\text{text} binom$",
    cursor: "$\\text{text} binom".length,
    shouldMatch: true
  },
  {
    name: "Parentheses around math should work",
    text: "($x+y binom$)",
    cursor: "($x+y binom".length,
    shouldMatch: true
  },
  {
    name: "Brace nesting in text should work",
    text: "$\\text{a {nested} brace} binom$",
    cursor: "$\\text{a {nested} brace} binom".length,
    shouldMatch: true
  },
  {
    name: "Closing $ heuristic check",
    text: "$x+y$ binom",
    cursor: "$x+y$ binom".length,
    shouldMatch: false
  },

  // --- Bug Fix Tests ---

  // 1. Double Brace Dedup
  // Scenario: User types '{'. Editor inserts '}'. Text is "{}". User types '{' again (if macro triggers on char, but here it triggers on '{').
  // Wait, macro trigger is '{'. 
  // If text is "$${|}$$" (cursor at 3). User typed '{' previously.
  // Actually, the issue is generic: if macro inserts "{}", and next char is "}", it should dedup.
  {
    name: "Double brace dedup: { followed by }",
    text: "$${}$$", 
    cursor: 3, // $ $ { | } $ $
    shouldMatch: true,
    expectedReplacement: "{" // original replacement is "{$0}$1", dedup logic removes "}" -> "{" (plus placeholders)
    // The engine returns clean text in replacementText property (markers stripped?? No, placeholders are kept in replacementText?)
    // checking processReplacement: "clean" has placeholders removed? 
    // Wait, processReplacement strips markers?
    // checkMacroTrigger returns replacementText which is `text` from processReplacement.
    // processReplacement: clean += content (for complex) or matches placeholders.
    // It seems placeholders like $0 are STRIPPED/handled in tabStopsMap, but wait...
    // In processReplacement loop:
    // if char is $, check match...
    //   if complexMatch: clean += content.
    //   if simpleMatch: tabStopsMap... (content skipped?).
    // A simpleMatch $0 doesn't add text to clean.
    // So "{$0}" -> clean is "{".
    // "{$0}$1" -> clean is "{}".
    // So dedup logic: removes last char if matching. -> "{"
  },

  // 2. Greek Expansion
  {
    name: "Greek expansion: pi should work",
    text: "$$pi$$", // text before cursor is $$pi
    cursor: 4, // $ $ p i | $ $
    shouldMatch: true,
    expectedReplacement: "$\\pi" // The trigger is ([^\\\\])(${GREEK}). Captures prev char "$".
  },

  // 3. Dint Tabstops
  {
    name: "dint tabstop order",
    text: "$$dint$$",
    cursor: 6,
    shouldMatch: true,
    // replacement: \int_{${0:0}}^{${1:1}} $2 \, d${3:x} $4
    // Text inserted at index 2 (after $$).
    // \int_{ is 6 chars.
    // 0 is at 2+6 = 8.
    expectedSelectionStartOffset: 8
  }
];

let failed = 0;

console.log("Running macro engine tests...");

tests.forEach(test => {
  const result = checkMacroTrigger(test.text, test.cursor, macros);
  const matchFound = result !== null;
  
  if (matchFound !== test.shouldMatch) {
    console.log(`❌ FAIL: ${test.name}`);
    console.log(`   Expected match: ${test.shouldMatch}, Got: ${matchFound}`);
    failed++;
    return;
  }

  if (matchFound && result) {
    let subFail = false;
    if (test.expectedReplacement) {
       // Allow partial match if needed, but strict is better.
       // For "pi", result includes the preceding char.
       if (result.replacementText !== test.expectedReplacement) {
         // Special handling for pi since I might have miscalculated the preceding char in strict eq
         if (!result.replacementText.endsWith(test.expectedReplacement.slice(1))) { // vague check
             // Let's stick to strict if we are sure.
             // If test says expected "{\pi" but got "$\pi", strict fail is good info.
         }
         
         // For dedup test: expected "{"
         if (test.expectedReplacement === "{" && result.replacementText === "{") {
             // pass
         } else if (result.replacementText !== test.expectedReplacement) {
             console.log(`❌ FAIL (Replacement): ${test.name}`);
             console.log(`   Expected text: "${test.expectedReplacement}"`);
             console.log(`   Got: "${result.replacementText}"`);
             subFail = true;
         }
       }
    }

    if (test.expectedSelectionStartOffset !== undefined) {
      if (result.selection.start !== test.expectedSelectionStartOffset) {
         console.log(`❌ FAIL (Selection): ${test.name}`);
         console.log(`   Expected selection start: ${test.expectedSelectionStartOffset}`);
         console.log(`   Got: ${result.selection.start}`);
         subFail = true;
      }
    }

    if (subFail) {
        failed++;
    } else {
        console.log(`✅ PASS: ${test.name}`);
    }
  } else {
    console.log(`✅ PASS: ${test.name}`);
  }
});

if (failed === 0) {
  console.log("\nAll tests passed!");
  process.exit(0);
} else {
  console.log(`\n${failed} tests failed.`);
  process.exit(1);
}
