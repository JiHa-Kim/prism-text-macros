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
        <button class="action-btn edit-btn" data-index="${index}" title="Edit">✎</button>
        <button class="action-btn delete-btn delete" data-index="${index}" title="Delete">🗑</button>
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

  // Add event listeners to buttons
  document.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        const idx = parseInt((e.currentTarget as HTMLElement).getAttribute('data-index') || '0');
        if (confirm("Delete this macro?")) {
            allMacros.splice(idx, 1);
            saveMacros();
            renderMacroList(searchInput.value);
        }
    });
  });
};

// Load macros from storage
const load = async () => {
  try {
    const data = await chrome.storage.sync.get(["snips"]);
    if (data.snips && Array.isArray(data.snips)) {
      allMacros = data.snips;
    } else {
      allMacros = defaultSnippets;
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
    
        await chrome.storage.sync.set({ snips: jsonToStore });
        box.value = serializeMacros(allMacros);
    } catch (e: any) {
        showStatus("Error: " + e.message, 'error');
    }
};

// View Switching
const showMacrosView = () => {
    macroListView.style.display = 'block';
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
        allMacros = JSON.parse(JSON.stringify(defaultSnippets));
        await saveMacros();
        renderMacroList();
        showStatus("Reset to defaults.");
    }
});

newMacroBtn.addEventListener('click', () => {
    const trigger = prompt("Enter macro trigger (e.g. sq):");
    if (!trigger) return;
    const replacement = prompt("Enter replacement text:");
    if (!replacement) return;
    
    allMacros.push({
        trigger,
        replacement,
        options: "mA",
        description: "",
        id: Math.random().toString(36).substr(2, 9)
    });
    
    saveMacros();
    renderMacroList(searchInput.value);
    showStatus("Macro added.");
});

load();
