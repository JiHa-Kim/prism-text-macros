
import { checkMacroTrigger } from './src/lib/macroEngine';
import { Macro } from './src/lib/types';

const macros: Macro[] = [
    { trigger: "binom", replacement: "\\binom{$0}{$1}$2", options: "mA" },
    { trigger: "mk", replacement: "$$0$", options: "tA" },
];

const test = (text: string, cursor: number) => {
    const match = checkMacroTrigger(text, cursor, macros);
    console.log(`Text: "${text}", Cursor: ${cursor}, Match: ${match ? match.replacementText : 'NONE'}`);
};

console.log("--- Text Mode ---");
test("binom", 5);
test("mk", 2);

console.log("\n--- Math Mode ($) ---");
test("$binom", 6);
test("$ binom", 7);

console.log("\n--- Math Mode ($$) ---");
test("$$\nbinom", 8);

console.log("\n--- Math Mode (\\begin{equation}) ---");
test("\\begin{equation}\nbinom", 22);
