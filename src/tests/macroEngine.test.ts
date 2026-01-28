import { checkMacroTrigger } from '../macroEngine';
import { defaultSnippets } from '../defaultSnippets';

const tests = [
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
    shouldMatch: true
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
  }
];

let failed = 0;
tests.forEach(test => {
  const result = checkMacroTrigger(test.text, test.cursor, defaultSnippets);
  const matchFound = result !== null;
  if (matchFound === test.shouldMatch) {
    console.log(`✅ PASS: ${test.name}`);
  } else {
    console.log(`❌ FAIL: ${test.name}`);
    console.log(`   Expected match: ${test.shouldMatch}, Got: ${matchFound}`);
    if (result) {
      console.log(`   Triggered: "${result.replacementText}"`);
    }
    failed++;
  }
});

if (failed === 0) {
  console.log("\nAll tests passed!");
  process.exit(0);
} else {
  console.log(`\n${failed} tests failed.`);
  process.exit(1);
}
