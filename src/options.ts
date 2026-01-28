import { parseMacros, serializeMacros, expandMacros } from './macroUtils';
import { defaultSnippets } from './defaultSnippets';
import { Macro } from './types';

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

// Show status message
const showStatus = (msg: string, type: 'success' | 'error' = 'success') => {
  status.textContent = msg;
  status.className = `visible ${type}`;
  setTimeout(() => {
    status.className = '';
  }, 2000);
};

// Render macro list
const renderMacroList = (filter: string = '') => {
  macroList.innerHTML = '';
  const filtered = allMacros.filter(m => {
    const triggerStr = m.trigger instanceof RegExp ? m.trigger.source : m.trigger;
    const desc = m.description || '';
    return triggerStr.toLowerCase().includes(filter.toLowerCase()) || 
           desc.toLowerCase().includes(filter.toLowerCase());
  });

  filtered.forEach((m, index) => {
    const card = document.createElement('div');
    card.className = 'macro-card';
    
    const triggerStr = m.trigger instanceof RegExp ? m.trigger.source : m.trigger;
    
    card.innerHTML = `
      <div class="macro-info">
        <div class="macro-trigger">${triggerStr}</div>
        <div class="macro-description">${m.description || 'No description'}</div>
      </div>
      <div class="macro-actions">
        <button class="action-btn edit-btn" data-id="${m.id}" title="Edit">✎</button>
        <button class="action-btn delete-btn delete" data-id="${m.id}" title="Delete">🗑</button>
      </div>
    `;

    // Snappy Staggered animation
    card.style.opacity = '0';
    card.style.transform = 'translateY(10px)';
    card.style.transition = 'all 0.4s cubic-bezier(0.16, 1, 0.3, 1)';
    
    
    macroList.appendChild(card);
    
    setTimeout(() => {
        card.style.opacity = '1';
        card.style.transform = 'translateY(0)';
    }, index * 30);
  });
};

// Editor State
let activeEditorId: string | null = null; // ID of macro being edited, or "NEW"

const getOptionsFromStr = (opt: string) => {
    return {
        isMath: opt.includes('m') || opt.includes('M'),
        isText: opt.includes('t') || opt.includes('n'),
        isAuto: opt.includes('A'),
        isWord: opt.includes('w'),
        isRegex: opt.includes('r')
    };
};

const renderEditor = (macro: Macro | null, container: HTMLElement) => {
    const isNew = !macro;
    const opts = getOptionsFromStr(macro?.options || "mA");
    
    // Determine detailed mode
    let envMode = 'any';
    if (opts.isMath) envMode = 'math';
    if (opts.isText) envMode = 'text';

    const html = `
    <div class="macro-editor" id="editor-${isNew ? 'NEW' : macro!.id}">
        <div class="form-row">
            <div class="col form-group">
                <label>Trigger</label>
                <input type="text" class="form-control" id="edit-trigger" value="${isNew ? '' : (macro!.trigger instanceof RegExp ? (macro!.trigger as RegExp).source : macro!.trigger).replace(/"/g, '&quot;')}" placeholder="e.g. sq">
            </div>
            <div class="col form-group">
                <label>Description</label>
                <input type="text" class="form-control" id="edit-desc" value="${isNew ? '' : (macro!.description || '').replace(/"/g, '&quot;')}" placeholder="Optional description">
            </div>
        </div>

        <div class="form-group">
            <label>Replacement</label>
            <textarea class="form-control" id="edit-replacement" placeholder="Replacement text...">${isNew ? '' : (typeof macro!.replacement === 'function' ? macro!.replacement.toString() : macro!.replacement)}</textarea>
        </div>

        <div class="form-group">
            <label>Options</label>
            <div class="options-group">
                <div class="radio-group">
                    <div class="radio-option">
                        <input type="radio" name="env-mode" id="mode-any" value="any" ${envMode === 'any' ? 'checked' : ''}>
                        <label for="mode-any">Anywhere</label>
                    </div>
                    <div class="radio-option">
                        <input type="radio" name="env-mode" id="mode-math" value="math" ${envMode === 'math' ? 'checked' : ''}>
                        <label for="mode-math">Math Mode</label>
                    </div>
                    <div class="radio-option">
                        <input type="radio" name="env-mode" id="mode-text" value="text" ${envMode === 'text' ? 'checked' : ''}>
                        <label for="mode-text">Text Mode</label>
                    </div>
                </div>

                <div class="checkbox-group">
                    <label class="checkbox-label">
                        <input type="checkbox" id="opt-auto" ${opts.isAuto ? 'checked' : ''}>
                        <span>Auto-Expand</span>
                    </label>
                    <label class="checkbox-label">
                        <input type="checkbox" id="opt-word" ${opts.isWord ? 'checked' : ''}>
                        <span>Word Boundary</span>
                    </label>
                    <label class="checkbox-label">
                        <input type="checkbox" id="opt-regex" ${opts.isRegex ? 'checked' : ''}>
                        <span>Regex</span>
                    </label>
                </div>
            </div>
        </div>

        <div class="editor-actions">
            <button class="btn btn-secondary" id="cancel-edit">Cancel</button>
            <button class="btn btn-primary" id="save-edit">Save Macro</button>
        </div>
    </div>
    `;

    container.innerHTML = html;
    
    // Focus trigger
    (container.querySelector('#edit-trigger') as HTMLInputElement).focus();

    // Bind events
    container.querySelector('#cancel-edit')?.addEventListener('click', () => {
        activeEditorId = null;
        renderMacroList(searchInput.value);
    });

    container.querySelector('#save-edit')?.addEventListener('click', () => {
        saveMacroFromEditor(isNew ? null : macro!.id!);
    });
};

const saveMacroFromEditor = (id: string | null) => {
    const triggerInput = document.getElementById('edit-trigger') as HTMLInputElement;
    const replacementInput = document.getElementById('edit-replacement') as HTMLTextAreaElement;
    const descInput = document.getElementById('edit-desc') as HTMLInputElement;
    
    if (!triggerInput.value || !replacementInput.value) {
        showStatus("Trigger and replacement are required.", "error");
        return;
    }

    // Build Options String
    let opts = "";
    const envMode = (document.querySelector('input[name="env-mode"]:checked') as HTMLInputElement).value;
    if (envMode === 'math') opts += 'm';
    if (envMode === 'text') opts += 't';
    
    if ((document.getElementById('opt-auto') as HTMLInputElement).checked) opts += 'A';
    if ((document.getElementById('opt-word') as HTMLInputElement).checked) opts += 'w';
    if ((document.getElementById('opt-regex') as HTMLInputElement).checked) opts += 'r';

    const newMacro: Macro = {
        id: id || Math.random().toString(36).substr(2, 9),
        trigger: (document.getElementById('opt-regex') as HTMLInputElement).checked 
            ? new RegExp(triggerInput.value) // Note: simple regex creation. UX for flags logic inside regex might be needed later, but this assumes basic pattern.
            : triggerInput.value,
        replacement: replacementInput.value,
        description: descInput.value,
        options: opts
    };

    if (id) {
        // Update existing
        const idx = allMacros.findIndex(m => m.id === id);
        if (idx !== -1) allMacros[idx] = newMacro;
    } else {
        // Add new
        allMacros.unshift(newMacro);
    }

    activeEditorId = null;
    saveMacros();
    renderMacroList(searchInput.value);
    showStatus(id ? "Macro updated." : "Macro created.");
};

// Event Delegation for Edit and Delete
macroList.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  
  // Don't interfere if clicking inside the editor
  if (target.closest('.macro-editor')) return;

  const editBtn = target.closest('.edit-btn');
  const deleteBtn = target.closest('.delete-btn');

  if (editBtn) {
    const id = editBtn.getAttribute('data-id');
    if (!id) return;
    
    // Don't open if already editing this one
    if (activeEditorId === id) return;
    
    // Close other editors if any (simple approach: re-render list)
    if (activeEditorId) {
        renderMacroList(searchInput.value);
    }

    const macro = allMacros.find(m => m.id === id);
    if (!macro) return;

    // Find the card to replace
    const card = editBtn.closest('.macro-card');
    if (card) {
        // Create a wrapper or use the card itself? 
        // Better to swap the element.
        const container = document.createElement('div');
        card.replaceWith(container);
        activeEditorId = id;
        renderEditor(macro, container);
    }
  } else if (deleteBtn) {
    const id = deleteBtn.getAttribute('data-id');
    if (confirm("Delete this macro?")) {
        allMacros = allMacros.filter(m => m.id !== id);
        saveMacros();
        renderMacroList(searchInput.value);
        showStatus("Macro deleted.");
    }
  }
});

// Load macros from storage
const load = async () => {
  try {
    let data = await chrome.storage.local.get(["snips"]);
    
    // Fallback to sync if local is empty (migration path)
    if (!data.snips) {
        console.log("No local macros found, checking sync storage...");
        data = await chrome.storage.sync.get(["snips"]);
    }

    if (data.snips && Array.isArray(data.snips)) {
      allMacros = data.snips.map((m: any) => ({
        ...m,
        id: m.id || Math.random().toString(36).substr(2, 9)
      }));
    } else {
      allMacros = (defaultSnippets as Macro[]).map(m => ({
        ...m,
        id: m.id || Math.random().toString(36).substr(2, 9)
      }));
    }
    box.value = serializeMacros(allMacros);
    renderMacroList();
  } catch (e) {
    console.error("Load error", e);
    showStatus("Error loading settings.", 'error');
  }
};

// Save macros to storage
const saveMacros = async () => {
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
    
        await chrome.storage.local.set({ snips: jsonToStore });
        box.value = serializeMacros(allMacros);
    } catch (e: any) {
        showStatus("Error: " + e.message, 'error');
    }
};

// View Switching
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
    box.value = serializeMacros(allMacros);
};

// Event Listeners
navMacros.addEventListener('click', showMacrosView);
navAdvanced.addEventListener('click', showAdvancedView);

searchInput.addEventListener('input', (e) => {
    renderMacroList((e.target as HTMLInputElement).value);
});

saveAdvancedBtn.addEventListener('click', async () => {
    try {
        const text = box.value;
        const parsed = parseMacros(text);
        allMacros = parsed;
        await saveMacros();
        showStatus("Saved successfully.");
        renderMacroList(searchInput.value);
    } catch (e: any) {
        showStatus("Parse error: " + e.message, 'error');
    }
});

resetBtn.addEventListener('click', async () => {
    if (confirm("Reset to default snippets? This will overwrite your changes.")) {
        allMacros = defaultSnippets.map(m => ({
            ...m,
            // Ensure unique IDs for the new set
            id: m.id || Math.random().toString(36).substr(2, 9) 
        }));
        await saveMacros();
        renderMacroList();
        showStatus("Reset to defaults.");
    }
});

newMacroBtn.addEventListener('click', () => {
    if (activeEditorId === 'NEW') return;
    
    // Close any other open editor
    if (activeEditorId) {
        renderMacroList(searchInput.value);
    }

    activeEditorId = 'NEW';
    
    // Insert new editor at top
    const container = document.createElement('div');
    macroList.prepend(container);
    renderEditor(null, container);
});

load();
