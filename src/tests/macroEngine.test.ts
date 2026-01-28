import { checkMacroTrigger } from '../lib/macroEngine';
import { defaultSnippets } from '../lib/defaultSnippets';
import { expandMacros } from '../lib/macroUtils';

const macros = expandMacros([
  ...defaultSnippets,
  { trigger: "{", replacement: "{$0}$1", options: "mA" }
]);

interface TestCase {
  name: string;
  text: string;
  cursor: number;
  shouldMatch: boolean;
  expectedReplacement?: string;
  expectedSnippetText?: string;
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

  // 2. Greek Expansion
  {
    name: "Greek expansion: pi should work",
    text: "$$pi",
    cursor: 4,
    shouldMatch: true,
    expectedReplacement: "$\\pi"
  },

  // 3. Fraction Expansion (Desired Feature)
  {
    name: "Auto fraction: sin(x)/ should work",
    text: "$\\sin(x)/",
    cursor: "$\\sin(x)/".length,
    shouldMatch: true,
    expectedReplacement: "\\frac{\\sin(x)}{}"
  },
  {
    name: "Auto fraction: simple variable x/",
    text: "$x/",
    cursor: "$x/".length,
    shouldMatch: true,
    expectedReplacement: "\\frac{x}{}"
  },
  {
    name: "Auto fraction: command \\alpha/",
    text: "$\\alpha/",
    cursor: "$\\alpha/".length,
    shouldMatch: true,
    expectedReplacement: "\\frac{\\alpha}{}"
  },
  {
    name: "Auto fraction: group (a+b)/",
    text: "$(a+b)/",
    cursor: "$(a+b)/".length,
    shouldMatch: true,
    expectedReplacement: "\\frac{(a+b)}{}"
  },

  // 4. Brackets and Priorities
  {
    name: "Bracket auto-pair: (",
    text: "$(",
    cursor: 2,
    shouldMatch: true,
    expectedReplacement: "()"
  },
  {
    name: "Priority check: dint vs int",
    text: "$dint",
    cursor: 5,
    shouldMatch: true,
    expectedReplacement: "\\int_{0}^{1}  \\, dx " // dint has higher priority/length
  },

  // 5. Dint Tabstops
  {
    name: "dint tabstop order",
    text: "$$dint$$",
    cursor: 6,
    shouldMatch: true,
    expectedSnippetText: "\\\\int_{${1:0}}^{${2:1}} ${3} \\\\, d${4:x} ${5}",
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

    if (test.expectedSnippetText !== undefined) {
      if (result.snippetText !== test.expectedSnippetText) {
          console.log(`❌ FAIL (Snippet): ${test.name}`);
          console.log(`   Expected snippet: "${test.expectedSnippetText}"`);
          console.log(`   Got: "${result.snippetText}"`);
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
