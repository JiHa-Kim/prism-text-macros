
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
    const parsed = parseMacros(text);

    const jsonToStore = parsed.map(m => {
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
