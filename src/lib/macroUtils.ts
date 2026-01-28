
import { Macro } from './types';

/**
 * Converts triggers/replacements to serializable format (strings)
 */
export const prepareForStorage = (macros: Macro[]): any[] => {
    return macros.map(m => {
        const isRegex = m.trigger instanceof RegExp;
        const isFunc = typeof m.replacement === 'function';
        
        return {
            ...m,
            trigger: isRegex ? (m.trigger as RegExp).source : m.trigger,
            isRegex,
            replacement: isFunc ? (m.replacement as Function).toString() : m.replacement,
            isFunc,
            jsName: m.jsName
        };
    });
};

const SNIPPET_VARIABLES: Record<string, string> = {
  "GREEK": "alpha|beta|gamma|Gamma|delta|Delta|epsilon|varepsilon|zeta|eta|theta|Theta|vartheta|iota|kappa|lambda|Lambda|mu|nu|xi|Xi|pi|Pi|rho|varrho|sigma|Sigma|tau|upsilon|Upsilon|phi|Phi|varphi|chi|psi|Psi|omega|Omega",
  "SYMBOL": "infty|nabla|partial|dots|cdot|times|leftrightarrow|mapsto|setminus|mid|cap|cup|land|lor|subseteq|subset|implies|impliedby|iff|exists|forall|equiv|cong|simeq|approx|sim|propto|le|ge|simeq|approx",
  "MORE_SYMBOLS": "int|sum|prod|lim"
};

export const normalizeLatex = (latex: string): string => {
  if (!latex) return '';
  let norm = latex;

  // 1. Strip Snippet Markers ($0 - $9) which might be present in editor state
  // We handle simple markers like $1, and default placeholder values like ${1:x} -> x
  norm = norm.replace(/\$\{\d+:([^}]+)\}/g, '$1');
  norm = norm.replace(/\$[0-9]/g, '');

  // 2. Remove whitespace
  norm = norm.replace(/\s+/g, '');

  // 3. Remove spacing commands: \, \; \: \! \quad \qquad \enspace \thickspace
  // We match backslash followed by one of these commands
  norm = norm.replace(/\\(,|;|:|!|quad|qquad|enspace|thickspace)/g, '');

  // 4. Remove \left and \right commands but keep content
  norm = norm.replace(/\\left/g, '').replace(/\\right/g, '');

  // 5. Normalize superscripts/subscripts
  // Case A: Single char arg: ^x -> ^{x}, _i -> _{i}
  // Matches any single char that isn't a backslash or brace
  norm = norm.replace(/(\^|_)([^\\{}])/g, '$1{$2}');

  // Case B: Command arg: ^\infty -> ^{\infty}, _\alpha -> _{\alpha}
  // Match ^ or _ followed by backslash and letters
  norm = norm.replace(/(\^|_)\\([a-zA-Z]+)/g, '$1{\\$2}');

  // 6. Normalize \sqrt and similar single-arg commands structure
  // \sqrt\pi -> \sqrt{\pi} (followed by command)
  norm = norm.replace(/\\sqrt\\([a-zA-Z]+)/g, '\\sqrt{\\$1}');
  // \sqrt2 -> \sqrt{2} (followed by single char)
  norm = norm.replace(/\\sqrt([a-zA-Z0-9])/g, '\\sqrt{$1}');

  // 7. Consolidate empty braces {} (sometimes typed by users or artifacts)
  norm = norm.replace(/\^\{\}/g, '').replace(/_\{\}/g, '');

  return norm;
};

export const serializeMacros = (macros: Macro[]): string => {
  const itemStrings = macros.map(m => {
    const triggerStr = m.trigger instanceof RegExp ? m.trigger.toString() : JSON.stringify(m.trigger);
    const replaceStr = typeof m.replacement === 'function' ? m.replacement.toString() : JSON.stringify(m.replacement);

    // Build the macro object string with proper indentation
    const lines = [
      `    {`,
      `        "trigger": ${triggerStr},`,
      `        "replacement": ${replaceStr},`,
      `        "options": ${JSON.stringify(m.options || "mA")},`,
      `        "priority": ${m.priority || 0},`,
      `        "description": ${JSON.stringify(m.description || "")}`
    ];

    if (m.jsName) {
      lines.push(`        "jsName": ${JSON.stringify(m.jsName)}`);
    }

    lines.push(`    }`);
    return lines.join('\n');
  });

  return `[\n${itemStrings.join(',\n')}\n]`;
};

export const expandMacros = (macros: Macro[]): Macro[] => {
  return macros.map(m => {
    let trigger = m.trigger;
    if (typeof trigger === 'string') {
      for (const [key, val] of Object.entries(SNIPPET_VARIABLES)) {
        if (trigger.includes(`\${${key}}`)) {
          trigger = trigger.split(`\${${key}}`).join(val);
        }
      }
    }
    return {
      ...m,
      trigger,
      id: m.id || Math.random().toString(36).substr(2, 9)
    };
  });
};

export const parseMacros = (source: string): Macro[] => {
  try {
    // Safe-ish eval for configuration snippets. 
    // We use new Function to evaluate the array expression.
    const fn = new Function("return " + source);
    const result = fn();

    if (!Array.isArray(result)) {
      throw new Error("Macro snippet must return an array of objects.");
    }

    return expandMacros(result);
  } catch (e) {
    console.error("Failed to parse macros", e);
    throw e;
  }
};