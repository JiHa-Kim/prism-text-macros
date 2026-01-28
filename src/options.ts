
import { parseMacros, serializeMacros } from './macroUtils';
import { defaultSnippets } from './defaultSnippets';

const box = document.getElementById("box") as HTMLTextAreaElement;
const status = document.getElementById("status") as HTMLDivElement;
const saveBtn = document.getElementById("save") as HTMLButtonElement;
const resetBtn = document.getElementById("reset") as HTMLButtonElement;

const load = async () => {
  try {
    const data = await chrome.storage.sync.get(["snips"]);
    let macros = [];
    if (data.snips && Array.isArray(data.snips)) {
      macros = data.snips;
    } else {
      macros = defaultSnippets;
    }
    // We want to show the JSON representation
    // Serialize it nicely
    box.value = serializeMacros(macros);
  } catch (e) {
    console.error("Load error", e);
    status.textContent = "Error loading settings.";
    status.className = "error";
  }
};

const save = async () => {
  try {
    const text = box.value;
    // Parse using our utility to ensure validity
    const parsed = parseMacros(text);

    // We store the PARSED objects (clean JSON), not the string
    // But wait, our parseMacros returns Macro[] objects which might have RegExps or Functions.
    // Chrome storage cannot store Functions or RegExps directly in JSON.
    // We need to store a SERIALIZABLE format. 
    // Actually, usually we store the source string or a JSON config.
    // If we want to support RegExps, we should store the source string components.

    // STRATEGY CHANGE: We will store the JSON entries. 
    // If the user writes a custom function in the textarea, 'parseMacros' evaluates it.
    // We need to convert that back to a storeable format if we want to retrieve it.
    // HOWEVER, for simplicity in MV3, we should probably store the *Source Text*?
    // Or just store the JSON object and reconstruct RegExps at runtime?

    // Let's store the raw JSON object. 
    // But JSON.stringify drops functions and regexps become {}. 
    // So we need a "Hydrated" vs "Dehydrated" state.

    // Simple approach for now:
    // We will assume the user provides valid JSON-serializable macros (strings for regexes).
    // If they provide complex JS, it won't persist well in storage.sync unless we store the *string* of the function.

    // Let's rely on JSON.parse/stringify for storage.
    // If the input is valid JS array but not JSON, we might lose data.
    // But 'serializeMacros' handles RegExp toString().
    // We need a way to 'hydrate' them back in content script.

    // For now, let's just save valid JSON.
    const jsonToStore = parsed.map(m => {
      return {
        ...m,
        trigger: m.trigger instanceof RegExp ? m.trigger.source : m.trigger,
        isRegex: m.trigger instanceof RegExp,
        // We'll warn if it's a function?
        // Existing default snippets have some functions. 
        // We'll try to .toString() the function?
        replacement: typeof m.replacement === 'function' ? m.replacement.toString() : m.replacement,
        isFunc: typeof m.replacement === 'function',
        jsName: m.jsName // Persist the registry name
      };
    });

    await chrome.storage.sync.set({ snips: jsonToStore });
    status.textContent = "Saved.";
    status.className = "success";
    setTimeout(() => { status.textContent = ""; }, 2000);
  } catch (e: any) {
    status.textContent = "Error: " + e.message;
    status.className = "error";
  }
};

const reset = async () => {
  if (confirm("Reset to default snippets? This will overwrite your changes.")) {
    box.value = serializeMacros(defaultSnippets);
  }
}

saveBtn.addEventListener("click", save);
resetBtn.addEventListener("click", reset);
load();
