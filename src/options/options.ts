import { parseMacros, serializeMacros } from '../lib/macroUtils';
import { defaultSnippets } from '../lib/defaultSnippets';
import { Macro } from '../lib/types';
import { loadMacrosFromStorage, saveMacrosToStorage } from '../lib/storage';
import { renderMacroList, renderEditor, getEditorData, showStatus } from './ui';

// DOM Elements
const macroListView = document.getElementById("macros-view") as HTMLDivElement;
const advancedView = document.getElementById("advanced-view") as HTMLDivElement;
const macroList = document.getElementById("macro-list") as HTMLDivElement;
const searchInput = document.getElementById("search-input") as HTMLInputElement;
const newMacroBtn = document.getElementById("new-macro-btn") as HTMLButtonElement;
const box = document.getElementById("box") as HTMLTextAreaElement;
const saveAdvancedBtn = document.getElementById("save-advanced") as HTMLButtonElement;
const resetBtn = document.getElementById("reset-btn") as HTMLElement;
const status = document.getElementById("status") as HTMLDivElement;

const navMacros = document.getElementById("nav-macros") as HTMLElement;
const navAdvanced = document.getElementById("nav-advanced") as HTMLElement;

let allMacros: Macro[] = [];
let activeEditorId: string | null = null;
let isAdvancedViewDirty = false;

// Save macros to storage
const saveMacros = async (options: { skipAdvancedUpdate?: boolean } = {}) => {
    try {
        const jsonToStore = allMacros.map(m => {
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
    
        await saveMacrosToStorage(chrome.storage.local, jsonToStore as Macro[]); // cast because serialization changes types slightly?
        
        // Notify background script to broadcast update with the data
        chrome.runtime.sendMessage({ 
            type: "MACROS_UPDATED", 
            macros: jsonToStore 
        });
        
        if (!options.skipAdvancedUpdate) {
            if (advancedView.style.display !== 'none') {
                box.value = serializeMacros(allMacros);
                isAdvancedViewDirty = false;
            } else {
                isAdvancedViewDirty = true;
            }
        }
    } catch (e: any) {
        showStatus(status, "Error: " + e.message, 'error');
    }
};

const handleSaveFromEditor = (id: string | null) => {
    const data = getEditorData();
    if (!data) return;
    if (!data.trigger || !data.replacement) {
        showStatus(status, "Trigger and replacement are required.", "error");
        return;
    }

    const newMacro: Macro = {
        id: id || Math.random().toString(36).substr(2, 9),
        trigger: data.trigger,
        replacement: data.replacement,
        description: data.description,
        options: data.options
    };

    if (id) {
        const idx = allMacros.findIndex(m => m.id === id);
        if (idx !== -1) allMacros[idx] = newMacro;
    } else {
        allMacros.unshift(newMacro);
    }

    activeEditorId = null;
    saveMacros();
    renderMacroList(allMacros, macroList, searchInput.value);
    showStatus(status, id ? "Macro updated." : "Macro created.");
};

const handleCancelEdit = () => {
    activeEditorId = null;
    renderMacroList(allMacros, macroList, searchInput.value);
};

// Event Delegation
macroList.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  if (target.closest('.macro-editor')) return;

  const editBtn = target.closest('.edit-btn');
  const deleteBtn = target.closest('.delete-btn');

  if (editBtn) {
    const id = editBtn.getAttribute('data-id');
    if (!id) return;
    
    if (activeEditorId === id) return;
    
    if (activeEditorId) {
        renderMacroList(allMacros, macroList, searchInput.value);
    }

    const macro = allMacros.find(m => m.id === id);
    if (!macro) return;

    const card = editBtn.closest('.macro-card');
    if (card) {
        const container = document.createElement('div');
        card.replaceWith(container);
        activeEditorId = id;
        renderEditor(macro, container, handleSaveFromEditor, handleCancelEdit);
    }
  } else if (deleteBtn) {
    const id = deleteBtn.getAttribute('data-id');
    if (confirm("Delete this macro?")) {
        allMacros = allMacros.filter(m => m.id !== id);
        saveMacros();
        renderMacroList(allMacros, macroList, searchInput.value);
        showStatus(status, "Macro deleted.");
    }
  }
});

// Init
const load = async () => {
  try {
    const data = await loadMacrosFromStorage(chrome.storage.local);
    // Ensure IDs
    allMacros = data.map((m: any) => ({
        ...m,
        id: m.id || Math.random().toString(36).substr(2, 9)
    }));
    
    // box.value = serializeMacros(allMacros); // Defer until view shown
    isAdvancedViewDirty = true; 
    renderMacroList(allMacros, macroList);
  } catch (e) {
    console.error("Load error", e);
    showStatus(status, "Error loading settings.", 'error');
  }
};

// View Switch
const showMacrosView = () => {
    macroListView.style.display = 'flex';
    advancedView.style.display = 'none';
    navMacros.classList.add('active');
    navAdvanced.classList.remove('active');
};

const showAdvancedView = () => {
    macroListView.style.display = 'none';
    advancedView.style.display = 'flex';
    navMacros.classList.remove('active');
    navAdvanced.classList.add('active');
    
    if (isAdvancedViewDirty) {
        box.value = serializeMacros(allMacros);
        isAdvancedViewDirty = false;
    }
};

navMacros.addEventListener('click', showMacrosView);
navAdvanced.addEventListener('click', showAdvancedView);

searchInput.addEventListener('input', (e) => {
    renderMacroList(allMacros, macroList, (e.target as HTMLInputElement).value);
});

saveAdvancedBtn.addEventListener('click', async () => {
    try {
        const text = box.value;
        const parsed = parseMacros(text);
        allMacros = parsed;
        await saveMacros({ skipAdvancedUpdate: true });
        showStatus(status, "Saved successfully.");
        renderMacroList(allMacros, macroList, searchInput.value);
    } catch (e: any) {
        showStatus(status, "Parse error: " + e.message, 'error');
    }
});

resetBtn.addEventListener('click', async () => {
    if (confirm("Reset to default snippets? This will overwrite your changes.")) {
        allMacros = defaultSnippets.map(m => ({
            ...m,
            id: m.id || Math.random().toString(36).substr(2, 9) 
        }));
        await saveMacros();
        renderMacroList(allMacros, macroList);
        showStatus(status, "Reset to defaults.");
    }
});

newMacroBtn.addEventListener('click', () => {
    if (activeEditorId === 'NEW') return;
    
    if (activeEditorId) {
        renderMacroList(allMacros, macroList, searchInput.value);
    }

    activeEditorId = 'NEW';
    const container = document.createElement('div');
    macroList.prepend(container);
    renderEditor(null, container, handleSaveFromEditor, handleCancelEdit);
});

load();
