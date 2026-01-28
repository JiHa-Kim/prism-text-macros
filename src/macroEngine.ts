
import { Macro } from './types';

/**
 * Determines if the cursor is currently inside a LaTeX math environment.
 * Supports:
 * - Inline $...$ (must be on the same line)
 * - Display $$...$$
 * - LaTeX environments: \begin{env}...\end{env}
 */
const isInsideMath = (text: string, cursorIndex: number): boolean => {
  const SCAN_LIMIT = 2000;
  const startIdx = Math.max(0, cursorIndex - SCAN_LIMIT);
  const localText = text.slice(startIdx, cursorIndex);

  let inMath = false;    // $...$ or \(...\)
  let inDisplay = false; // $$...$$ or \[...\]
  let envStack: string[] = [];
  let inTextCommandStack: number[] = [];
  let braceDepth = 0;

  // Comment + verbatim tracking
  let inComment = false;
  let ignoreEnvStack: string[] = [];

  const mathEnvs = [
    "equation", "align", "gather", "multline", "math", "displaymath",
    "pmatrix", "bmatrix", "Bmatrix", "vmatrix", "Vmatrix", "matrix",
    "aligned", "split", "cases",
  ];

  const ignoreEnvs = new Set([
    "verbatim", "Verbatim",
    "lstlisting",
    "minted",
    "tcolorbox", "tcblisting",
  ]);

  for (let i = 0; i < localText.length; i++) {
    const char = localText[i];

    if (inComment) {
      if (char === "\n") inComment = false;
      continue;
    }
    if (char === "%") {
      inComment = true;
      continue;
    }

    const ignoring = ignoreEnvStack.length > 0;

    if (!ignoring) {
      if (char === "{") {
        braceDepth++;
        continue;
      }
      if (char === "}") {
        if (
          inTextCommandStack.length > 0 &&
          inTextCommandStack[inTextCommandStack.length - 1] === braceDepth
        ) {
          inTextCommandStack.pop();
        }
        braceDepth = Math.max(0, braceDepth - 1);
        continue;
      }
    }

    if (char === "\\") {
      const nextIdx = i + 1;
      if (nextIdx < localText.length) {
        const remaining = localText.slice(nextIdx);

        const verbMatch = remaining.match(/^verb\*?/);
        if (verbMatch) {
          const afterVerbIdx = nextIdx + verbMatch[0].length;
          const delim = localText[afterVerbIdx];
          if (delim) {
            let j = afterVerbIdx + 1;
            while (j < localText.length && localText[j] !== delim) j++;
            i = j;
            continue;
          }
        }

        if (!ignoring) {
          const nextChar = localText[nextIdx];
          if (nextChar === "(") { inMath = true; i++; continue; }
          if (nextChar === ")") { inMath = false; i++; continue; }
          if (nextChar === "[") { inDisplay = true; i++; continue; }
          if (nextChar === "]") { inDisplay = false; i++; continue; }

          const textMatch = remaining.match(/^(text|intertext|texttt|mathrm|mathsf|mathtt|textnormal)\{/);
          if (textMatch) {
            i += textMatch[1].length + 1;
            braceDepth++;
            inTextCommandStack.push(braceDepth);
            continue;
          }
        }

        const beginMatch = remaining.match(/^begin\{([^}]+)\}/);
        const endMatch = remaining.match(/^end\{([^}]+)\}/);

        if (beginMatch) {
          const env = beginMatch[1].replace(/\*$/, "");
          if (ignoreEnvs.has(env)) {
            ignoreEnvStack.push(env);
          } else if (!ignoring && mathEnvs.includes(env)) {
            envStack.push(env);
          }
          i += beginMatch[0].length;
          continue;
        } else if (endMatch) {
          const env = endMatch[1].replace(/\*$/, "");
          if (ignoreEnvStack.length > 0 && ignoreEnvStack[ignoreEnvStack.length - 1] === env) {
            ignoreEnvStack.pop();
          } else if (!ignoring && envStack.length > 0 && envStack[envStack.length - 1] === env) {
            envStack.pop();
          }
          i += endMatch[0].length;
          continue;
        }
      }
      i++;
      continue;
    }

    if (ignoring) continue;

    if (char === "\n") {
      inMath = false;
      continue;
    }

    if (char === "$") {
      const prev = i > 0 ? localText[i - 1] : "";
      const next = localText[i + 1] || "";

      if (next === "$") {
        inDisplay = !inDisplay;
        if (inDisplay) inMath = false;
        i++;
        continue;
      }

      if (!inDisplay) {
        // Heuristic: Opening $ usually not followed by space, Closing $ usually not preceded by space
        // Also avoid currency: $100 and Shell variables: $HOME, $PATH
        if (!inMath) {
          // Opening logic
          const isCurrency = /[0-9]/.test(next);
          const isShellVar = /^[A-Z_]+/.test(localText.slice(i + 1));
          const hasLeadingSpace = (next === " ");
          if (!isCurrency && !isShellVar && !hasLeadingSpace) {
            inMath = true;
          }
        } else {
          // Closing logic
          const hasTrailingSpace = (prev === " ");
          if (!hasTrailingSpace) {
            inMath = false;
          }
        }
      }
      continue;
    }
  }

  return (inMath || inDisplay || envStack.length > 0) && inTextCommandStack.length === 0;
};



export interface TabStop {
  start: number;
  end: number;
}

export interface MacroResult {
  text: string;
  selection: TabStop;
  tabStops: TabStop[];
}

// Helper to unescape snippet content like \$, \}, \\
const unescapeSnippet = (text: string): string => {
  return text.replace(/\\([\$}\\])/g, '$1');
};

/**
 * Processes replacement, handling $0 (cursor), [[n]] (captures), and function replacements.
 * Returns clean text (no markers) and tab stop locations with ranges.
 */
export const processReplacement = (
  macro: Macro,
  captures: string[] = [],
  visualContent: string = ""
): MacroResult => {
  let raw = "";

  if (typeof macro.replacement === 'function') {
    try {
      raw = macro.replacement(captures);
    } catch (e) {
      console.error("Error executing macro function", e);
      raw = "ERROR";
    }
  } else {
    raw = macro.replacement;
    raw = raw.split('${VISUAL}').join(visualContent);
    captures.forEach((capture, index) => {
      const val = capture !== undefined ? capture : "";
      raw = raw.split(`[[${index}]]`).join(val);
    });
  }

  let clean = "";
  let tabStopsMap: Record<number, TabStop> = {};

  let i = 0;
  while (i < raw.length) {
    const char = raw[i];

    if (char === '\\') {
      const next = raw[i + 1] || "";
      if (['$', '}', '\\'].includes(next)) {
        clean += next;
        i += 2;
        continue;
      } else {
        clean += char;
        i++;
        continue;
      }
    }

    if (char === '$') {
      const sub = raw.slice(i);
      const complexMatch = sub.match(/^\$\{(\d+):([^}]*)\}/);
      if (complexMatch) {
        const id = parseInt(complexMatch[1]);
        const content = unescapeSnippet(complexMatch[2]);
        const start = clean.length;
        clean += content;
        const end = clean.length;
        if (!tabStopsMap[id]) tabStopsMap[id] = { start, end };
        i += complexMatch[0].length;
        continue;
      }

      const simpleMatch = sub.match(/^\$(\d+)/);
      if (simpleMatch) {
        const id = parseInt(simpleMatch[1]);
        if (!tabStopsMap[id]) tabStopsMap[id] = { start: clean.length, end: clean.length };
        i += simpleMatch[0].length;
        continue;
      }
    }

    clean += char;
    i++;
  }

  // Sort tabstops: natural order (0 is first if it appears first in sequence)
  const sortedIds = Object.keys(tabStopsMap).map(Number).sort((a, b) => {
    return a - b;
  });

  let selection: TabStop = { start: clean.length, end: clean.length };
  const nextStops: TabStop[] = [];

  if (sortedIds.length > 0) {
    selection = tabStopsMap[sortedIds[0]];
    for (let k = 1; k < sortedIds.length; k++) {
      nextStops.push(tabStopsMap[sortedIds[k]]);
    }
  }

  return { text: clean, selection, tabStops: nextStops };
};

export interface MacroMatch {
  replacementText: string;
  triggerRange: { start: number; end: number };
  selection: TabStop;
  tabStops: TabStop[];
}

/**
 * Checks if a macro is triggered at the current cursor position.
 */
export const checkMacroTrigger = (
  text: string,
  cursorIndex: number,
  macros: Macro[],
  forceMath: boolean = false,
  checkAuto: boolean = false
): MacroMatch | null => {
  const textBeforeCursor = text.slice(0, cursorIndex);
  const inMath = forceMath || isInsideMath(text, cursorIndex);

  // Filter and sort macros once (Priority DESC -> Length DESC -> Index DESC)
  const candidateMacros = macros
    .map((m, i) => ({ ...m, originalIndex: i }))
    .filter(m => {
      const options = m.options || "";
      const isAuto = options.includes('A');
      const modeMath = options.includes('m') || options.includes('M');
      const modeText = options.includes('t') || options.includes('n');

      if (checkAuto && !isAuto) return false;
      if (modeMath && !inMath) return false;
      if (modeText && inMath) return false;

      // Skip visual macros (require selection, not handled here)
      if (typeof m.replacement === 'string' && m.replacement.includes('${VISUAL}')) return false;

      // Word boundary check
      if (options.includes('w') && typeof m.trigger === 'string') {
        const charBefore = textBeforeCursor[textBeforeCursor.length - m.trigger.length - 1];
        if (charBefore && /[a-zA-Z0-9]/.test(charBefore)) return false;
      }

      return true;
    })
    .sort((a, b) => {
      const pA = a.priority || 0;
      const pB = b.priority || 0;
      if (pA !== pB) return pB - pA;

      const lenA = typeof a.trigger === 'string' ? a.trigger.length : (a.trigger as RegExp).source.length;
      const lenB = typeof b.trigger === 'string' ? b.trigger.length : (b.trigger as RegExp).source.length;
      if (lenA !== lenB) return lenB - lenA;

      return b.originalIndex - a.originalIndex;
    });

  for (const macro of candidateMacros) {
    const isRegex = macro.trigger instanceof RegExp || (macro.options || "").includes('r');
    let match: RegExpExecArray | null = null;
    let matchText = "";

    if (isRegex) {
      try {
        const pattern = macro.trigger instanceof RegExp ? macro.trigger.source : macro.trigger as string;
        const flags = macro.trigger instanceof RegExp ? macro.trigger.flags : "";
        const anchored = new RegExp(`${pattern}$`, flags);
        match = anchored.exec(textBeforeCursor);
        if (match) matchText = match[0];
      } catch (e) {
        console.warn("Regex macro failed", e);
      }
    } else if (typeof macro.trigger === 'string' && textBeforeCursor.endsWith(macro.trigger)) {
      matchText = macro.trigger;
    }

    if (matchText) {
      const replacementArgs = match ? (typeof macro.replacement === 'function' ? match : match.slice(1)) : [];
      let { text: replacementText, selection, tabStops } = processReplacement(macro, replacementArgs as string[]);

      // Check for auto-close duplication
      // If replacement ends with a closing char (}, ], )) and the next char in text is that char,
      // and the trigger didn't include it, we might want to skip outputting it.
      const closingPairs = [
          { open: '{', close: '}' },
          { open: '[', close: ']' },
          { open: '(', close: ')' },
      ];

      const nextChar = text[cursorIndex];
      const lastChar = replacementText.slice(-1);
      
      // Heuristic: Only dedup if the replacementText is short (like "{}") or simple wrapper
      // preventing aggressive dedup on complex macros.
      const pair = closingPairs.find(p => p.close === lastChar);
      if (pair && nextChar === pair.close) {
           // We remove the last char from replacement
           replacementText = replacementText.slice(0, -1);
           
           // Adjust selection and tabStops if they were at the very end
           const clamp = (val: number) => Math.min(val, replacementText.length);
           selection.start = clamp(selection.start);
           selection.end = clamp(selection.end);
           tabStops.forEach(ts => {
               ts.start = clamp(ts.start);
               ts.end = clamp(ts.end);
           });
      }

      const triggerStart = cursorIndex - matchText.length;
      const offsetRange = (ts: TabStop) => ({
        start: triggerStart + ts.start,
        end: triggerStart + ts.end
      });

      return {
        replacementText,
        triggerRange: { start: triggerStart, end: cursorIndex },
        selection: offsetRange(selection),
        tabStops: tabStops.map(offsetRange)
      };
    }
  }

  return null;
};