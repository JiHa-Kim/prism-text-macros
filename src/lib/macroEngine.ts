import { Macro, TabStop } from './types';

/**
 * LaTeX Parser to track math mode state.
 */
class LaTeXState {
  inMath = false;    // $...$ or \(...\)
  inDisplay = false; // $$...$$ or \[...\]
  envStack: string[] = [];
  inTextCommandStack: number[] = [];
  braceDepth = 0;
  inComment = false;
  ignoreEnvStack: string[] = [];

  readonly mathEnvs = new Set([
     "equation", "align", "gather", "multline", "math", "displaymath",
     "pmatrix", "bmatrix", "Bmatrix", "vmatrix", "Vmatrix", "matrix",
     "aligned", "split", "cases"
  ]);

  readonly ignoreEnvs = new Set([
     "verbatim", "Verbatim",
     "lstlisting",
     "minted",
     "tcolorbox", "tcblisting"
  ]);

  isMathMode() {
      return (this.inMath || this.inDisplay || this.envStack.length > 0) && this.inTextCommandStack.length === 0;
  }

  process(text: string, index: number): number {
      const char = text[index];
      
      if (this.inComment) {
          if (char === "\n") this.inComment = false;
          return 0;
      }
      if (char === "%") {
          this.inComment = true;
          return 0;
      }

      const ignoring = this.ignoreEnvStack.length > 0;
      
      // Delimiters
      if (!ignoring) {
          if (char === "{") {
              this.braceDepth++;
              return 0;
          }
          if (char === "}") {
              if (this.inTextCommandStack.length > 0 && 
                  this.inTextCommandStack[this.inTextCommandStack.length - 1] === this.braceDepth) {
                  this.inTextCommandStack.pop();
              }
              this.braceDepth = Math.max(0, this.braceDepth - 1);
              return 0;
          }
      }

      if (char === "\\") {
          return this.handleBackslash(text, index, ignoring);
      }

      if (!ignoring && char === "$") {
          return this.handleDollar(text, index);
      }
      
      if (char === "\n") {
          this.inMath = false;
      }

      return 0; // consumed 1 char (caller increments)
  }

  private handleBackslash(text: string, index: number, ignoring: boolean): number {
      const nextIdx = index + 1;
      if (nextIdx >= text.length) return 0;

      const remaining = text.slice(nextIdx);

      // Verb check
      const verbMatch = remaining.match(/^verb\*?/);
      if (verbMatch) {
          const afterVerbIdx = nextIdx + verbMatch[0].length;
          const delim = text[afterVerbIdx];
          if (delim) {
            let j = afterVerbIdx + 1;
            while (j < text.length && text[j] !== delim) j++;
            return j - index; // Skip to delimiter
          }
      }

      if (!ignoring) {
          const nextChar = text[nextIdx];
          if (nextChar === "(") { this.inMath = true; return 1; }
          if (nextChar === ")") { this.inMath = false; return 1; }
          if (nextChar === "[") { this.inDisplay = true; return 1; }
          if (nextChar === "]") { this.inDisplay = false; return 1; }

          const textMatch = remaining.match(/^(text|intertext|texttt|mathrm|mathsf|mathtt|textnormal)\{/);
          if (textMatch) {
             const skip = textMatch[1].length + 1;
             this.braceDepth++;
             this.inTextCommandStack.push(this.braceDepth);
             return skip; 
          }
      }

      const beginMatch = remaining.match(/^begin\{([^}]+)\}/);
      const endMatch = remaining.match(/^end\{([^}]+)\}/);

      if (beginMatch) {
          const env = beginMatch[1].replace(/\*$/, "");
          if (this.ignoreEnvs.has(env)) {
              this.ignoreEnvStack.push(env);
          } else if (!ignoring && this.mathEnvs.has(env)) {
              this.envStack.push(env);
          }
          return beginMatch[0].length;
      } else if (endMatch) {
          const env = endMatch[1].replace(/\*$/, "");
          if (this.ignoreEnvStack.length > 0 && this.getLast(this.ignoreEnvStack) === env) {
              this.ignoreEnvStack.pop();
          } else if (!ignoring && this.envStack.length > 0 && this.getLast(this.envStack) === env) {
              this.envStack.pop();
          }
          return endMatch[0].length;
      }
      
      return 0;
  }

  private handleDollar(text: string, index: number): number {
      const next = text[index + 1] || "";
      const prev = index > 0 ? text[index - 1] : "";

      if (next === "$") {
          this.inDisplay = !this.inDisplay;
          if (this.inDisplay) this.inMath = false;
          return 1; // Skip next $
      }

      if (!this.inDisplay) {
          if (!this.inMath) {
             const isCurrency = /[0-9]/.test(next);
             const isShellVar = /^[A-Z_]+/.test(text.slice(index + 1));
             const hasLeadingSpace = (next === " ");
             if (!isCurrency && !isShellVar && !hasLeadingSpace) {
                 this.inMath = true;
             }
          } else {
              const hasTrailingSpace = (prev === " ");
              if (!hasTrailingSpace) {
                  this.inMath = false;
              }
          }
      }
      return 0;
  }

  private getLast<T>(arr: T[]): T | undefined {
      return arr[arr.length - 1];
  }
}

const isInsideMath = (text: string, cursorIndex: number): boolean => {
  const parser = new LaTeXState();
  const startIdx = Math.max(0, cursorIndex - 2000);
  const localText = text.slice(startIdx, cursorIndex);

  for (let i = 0; i < localText.length; i++) {
      const skip = parser.process(localText, i);
      i += skip;
  }

  return parser.isMathMode();
};

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

  const sortedIds = Object.keys(tabStopsMap).map(Number).sort((a, b) => a - b);
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

export const checkMacroTrigger = (
  text: string,
  cursorIndex: number,
  macros: Macro[],
  forceMath: boolean = false,
  checkAuto: boolean = false
): MacroMatch | null => {
  const textBeforeCursor = text.slice(0, cursorIndex);
  const inMath = forceMath || isInsideMath(text, cursorIndex);

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

      if (typeof m.replacement === 'string' && m.replacement.includes('${VISUAL}')) return false;

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

      const closingPairs = [
          { open: '{', close: '}' },
          { open: '[', close: ']' },
          { open: '(', close: ')' },
      ];

      const nextChar = text[cursorIndex];
      const lastChar = replacementText.slice(-1);
      
      const pair = closingPairs.find(p => p.close === lastChar);
      if (pair && nextChar === pair.close) {
           replacementText = replacementText.slice(0, -1);
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