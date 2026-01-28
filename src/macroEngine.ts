
import { Macro } from './types';

/**
 * Determines if the cursor is currently inside a LaTeX math environment.
 * Supports both inline $...$ and display $$...$$
 */
const isInsideMath = (text: string, cursorIndex: number): boolean => {
  let inMath = false;    // $...$
  let inDisplay = false; // $$...$$

  for (let i = 0; i < cursorIndex; i++) {
    const char = text[i];

    // Skip escaped characters
    if (char === '\\') {
      i++;
      continue;
    }

    if (char === '$') {
      const next = text[i + 1] || '';

      if (next === '$') {
        // $$ detected: Toggle Display Mode
        inDisplay = !inDisplay;
        // If entering display mode, ensure inline is false (though usually mutually exclusive)
        if (inDisplay) inMath = false;
        i++; // Skip the second $
      } else {
        // $ detected: Toggle Inline Mode (only if not in Display Mode)
        if (!inDisplay) {
          inMath = !inMath;
        }
      }
    }
  }

  return inMath || inDisplay;
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

const unescapeSnippet = (text: string) => {
  let res = "";
  let i = 0;
  while (i < text.length) {
    const char = text[i];
    if (char === '\\') {
      const next = text[i + 1];
      if (['$', '}', '\\'].includes(next)) {
        res += next;
        i += 2;
        continue;
      }
    }
    res += char;
    i++;
  }
  return res;
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
      // Functions receive the full match array (standard regex behavior)
      raw = (macro.replacement as any)(captures);
    } catch (e) {
      console.error("Error executing macro function", e);
      raw = "ERROR";
    }
  } else {
    raw = macro.replacement;
    // Handle Visual Content
    raw = raw.split('${VISUAL}').join(visualContent);
    // Replace capture groups [[0]], [[1]], etc.
    captures.forEach((capture, index) => {
      const val = capture !== undefined ? capture : "";
      raw = raw.split(`[[${index}]]`).join(val);
    });
  }

  // Parse Tab Stops: $0, $1, ... $9 and ${1:default}
  let clean = "";
  // Map ID to the FIRST occurrence of that tabstop
  let tabStopsMap: Record<number, TabStop> = {};

  let i = 0;
  while (i < raw.length) {
    const char = raw[i];

    if (char === '\\') {
      const next = raw[i + 1] || "";

      // Only consume the backslash if it is escaping a special snippet character or another backslash
      // We DO NOT strictly interpret \n or \t here to avoid breaking LaTeX commands like \nu, \times
      if (['$', '}', '\\'].includes(next)) {
        clean += next;
        i += 2;
        continue;
      } else {
        // Otherwise, treat the backslash as a literal (e.g. \alpha, \int)
        clean += char;
        i++;
        continue;
      }
    }

    if (char === '$') {
      const sub = raw.slice(i);

      // Match ${1:default} - allow empty content with * instead of +
      const complexMatch = sub.match(/^\$\{(\d+):([^}]*)\}/);
      if (complexMatch) {
        const id = parseInt(complexMatch[1]);
        const rawContent = complexMatch[2];
        // Unescape the content inside the placeholder
        const content = unescapeSnippet(rawContent);

        const start = clean.length;
        clean += content;
        const end = clean.length; // Start and End define the range of 'content'

        if (!tabStopsMap[id]) {
          tabStopsMap[id] = { start, end };
        }
        i += complexMatch[0].length;
        continue;
      }

      // Match $1, $0 (Simple tabstops)
      const simpleMatch = sub.match(/^\$(\d+)/);
      if (simpleMatch) {
        const id = parseInt(simpleMatch[1]);
        const start = clean.length;
        if (!tabStopsMap[id]) {
          tabStopsMap[id] = { start, end: start };
        }
        i += simpleMatch[0].length;
        continue;
      }
    }

    clean += char;
    i++;
  }

  // Determine sequence by strict numerical sort (0, 1, 2...)
  // This supports macros where 0 is the first intended field (e.g. ${0:n})
  const sortedIds = Object.keys(tabStopsMap).map(Number).sort((a, b) => a - b);

  let selection: TabStop = { start: clean.length, end: clean.length };
  let nextStops: TabStop[] = [];

  if (sortedIds.length > 0) {
    // The lowest number is the initial selection
    selection = tabStopsMap[sortedIds[0]];

    // Subsequent numbers are added to the queue
    for (let k = 1; k < sortedIds.length; k++) {
      nextStops.push(tabStopsMap[sortedIds[k]]);
    }
  } else {
    // No markers found, cursor at end
    selection = { start: clean.length, end: clean.length };
  }

  return {
    text: clean,
    selection,
    tabStops: nextStops
  };
};

export interface MacroMatch {
  replacementText: string;
  triggerRange: { start: number; end: number };
  selection: TabStop;
  tabStops: TabStop[];
}

/**
 * Checks if a macro is triggered.
 */
export const checkMacroTrigger = (
  text: string,
  cursorIndex: number,
  macros: Macro[],
  forceMath: boolean = false,
  checkAuto: boolean = false
): MacroMatch | null => {
  const textBeforeCursor = text.slice(0, cursorIndex);
  // Remove textAfterCursor as we don't need it for full reconstruction anymore

  const inMath = forceMath || isInsideMath(text, cursorIndex);

  // Filter valid macros
  const validMacros = macros
    .map((m, i) => ({ ...m, originalIndex: i }))
    .filter(m => {
      const options = m.options || "";
      const modeMath = options.includes('m');
      const modeText = options.includes('t') || options.includes('n'); // n often used for normal/text
      const isAuto = options.includes('A');

      if (checkAuto && !isAuto) return false;

      if (modeMath && !inMath) return false;
      if (modeText && inMath) return false;

      // Strict check for visual macros:
      if (typeof m.replacement === 'string' && m.replacement.includes('${VISUAL}')) {
        return false;
      }

      // Word Boundary Check for 'w'
      if (options.includes('w')) {
        const triggerLen = typeof m.trigger === 'string' ? m.trigger.length : 0;
        // For regex, the regex itself usually handles boundaries, but we enforce it if possible
        // For string triggers, we must check.
        if (typeof m.trigger === 'string') {
          const idx = cursorIndex - triggerLen;
          if (idx > 0) {
            const charBefore = text[idx - 1];
            // If charBefore is a word char, then it's NOT a boundary start
            // We assume word chars are [a-zA-Z0-9]
            if (/[a-zA-Z0-9]/.test(charBefore)) return false;
          }
        }
      }

      return true;
    });

  // Sort: Priority DESC -> Length DESC -> Index DESC (Last defined wins)
  validMacros.sort((a, b) => {
    const pA = a.priority || 0;
    const pB = b.priority || 0;
    if (pA !== pB) return pB - pA;

    // Prioritize longer string triggers to prevent substring collisions (e.g. 'eset' vs 'set')
    const lenA = typeof a.trigger === 'string' ? a.trigger.length : 0;
    const lenB = typeof b.trigger === 'string' ? b.trigger.length : 0;
    if (lenA !== lenB) return lenB - lenA;

    return b.originalIndex - a.originalIndex;
  });

  for (const macro of validMacros) {
    const options = macro.options || "";

    // Case 1: RegExp Object Trigger
    if (macro.trigger instanceof RegExp) {
      try {
        const source = macro.trigger.source;
        const flags = macro.trigger.flags;
        const anchoredRegex = new RegExp(source + '$', flags);

        const match = anchoredRegex.exec(textBeforeCursor);
        if (match) {
          const matchText = match[0];

          let replacementArgs: any = match;
          if (typeof macro.replacement !== 'function') {
            replacementArgs = match.slice(1);
          }

          const { text: replacementText, selection, tabStops } = processReplacement(macro, replacementArgs);

          const triggerStart = cursorIndex - matchText.length;

          return {
            replacementText,
            triggerRange: { start: triggerStart, end: cursorIndex },
            selection: {
              start: triggerStart + selection.start,
              end: triggerStart + selection.end
            },
            tabStops: tabStops.map(ts => ({
              start: triggerStart + ts.start,
              end: triggerStart + ts.end
            }))
          };
        }
      } catch (e) {
        console.warn("Regex macro execution failed", e);
      }
    }
    // Case 2: String Trigger (optionally treated as Regex via 'r' flag)
    else if (typeof macro.trigger === 'string') {
      const isRegexString = options.includes('r');

      if (isRegexString) {
        try {
          const regex = new RegExp(macro.trigger + '$');
          const match = regex.exec(textBeforeCursor);

          if (match) {
            const matchText = match[0];

            let replacementArgs: any = match;
            if (typeof macro.replacement !== 'function') {
              replacementArgs = match.slice(1);
            }

            const { text: replacementText, selection, tabStops } = processReplacement(macro, replacementArgs);

            const triggerStart = cursorIndex - matchText.length;

            return {
              replacementText,
              triggerRange: { start: triggerStart, end: cursorIndex },
              selection: {
                start: triggerStart + selection.start,
                end: triggerStart + selection.end
              },
              tabStops: tabStops.map(ts => ({
                start: triggerStart + ts.start,
                end: triggerStart + ts.end
              }))
            };
          }
        } catch (e) { }
      } else {
        if (textBeforeCursor.endsWith(macro.trigger)) {
          const { text: replacementText, selection, tabStops } = processReplacement(macro);

          const triggerStart = cursorIndex - macro.trigger.length;

          return {
            replacementText,
            triggerRange: { start: triggerStart, end: cursorIndex },
            selection: {
              start: triggerStart + selection.start,
              end: triggerStart + selection.end
            },
            tabStops: tabStops.map(ts => ({
              start: triggerStart + ts.start,
              end: triggerStart + ts.end
            }))
          };
        }
      }
    }
  }

  return null;
};