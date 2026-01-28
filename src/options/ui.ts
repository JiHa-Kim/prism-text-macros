import { Macro } from '../lib/types';

// DOM Elements passed or retrieved?
// Better to pass container or find them?
// The original code used global consts.
// We can export references or just accept them.

export const renderMacroList = (macros: Macro[], container: HTMLElement, filter: string = '') => {
  container.innerHTML = '';
  const filtered = macros.filter(m => {
    const triggerStr = m.trigger instanceof RegExp ? m.trigger.source : (m.trigger || "");
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
    
    container.appendChild(card);
    
    setTimeout(() => {
        card.style.opacity = '1';
        card.style.transform = 'translateY(0)';
    }, index * 30);
  });
};

const getOptionsFromStr = (opt: string) => {
    return {
        isMath: opt.includes('m') || opt.includes('M'),
        isText: opt.includes('t') || opt.includes('n'),
        isAuto: opt.includes('A'),
        isWord: opt.includes('w'),
        isRegex: opt.includes('r')
    };
};

export const renderEditor = (
    macro: Macro | null, 
    container: HTMLElement, 
    onSave: (id: string | null) => void,
    onCancel: () => void
) => {
    const isNew = !macro;
    const opts = getOptionsFromStr(macro?.options || "mA");
    
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
    
    (container.querySelector('#edit-trigger') as HTMLInputElement).focus();

    container.querySelector('#cancel-edit')?.addEventListener('click', onCancel);

    container.querySelector('#save-edit')?.addEventListener('click', () => {
        onSave(isNew ? null : macro!.id!);
    });
};

export const showStatus = (el: HTMLElement, msg: string, type: 'success' | 'error' = 'success') => {
  el.textContent = msg;
  el.className = `visible ${type}`;
  setTimeout(() => {
    el.className = '';
  }, 2000);
};

export const getEditorData = () => {
    const triggerInput = document.getElementById('edit-trigger') as HTMLInputElement;
    const replacementInput = document.getElementById('edit-replacement') as HTMLTextAreaElement;
    const descInput = document.getElementById('edit-desc') as HTMLInputElement;
    
    if (!triggerInput || !replacementInput) return null;

    let opts = "";
    const envMode = (document.querySelector('input[name="env-mode"]:checked') as HTMLInputElement)?.value;
    if (envMode === 'math') opts += 'm';
    if (envMode === 'text') opts += 't';
    
    if ((document.getElementById('opt-auto') as HTMLInputElement).checked) opts += 'A';
    if ((document.getElementById('opt-word') as HTMLInputElement).checked) opts += 'w';
    if ((document.getElementById('opt-regex') as HTMLInputElement).checked) opts += 'r';

    const isRegex = (document.getElementById('opt-regex') as HTMLInputElement).checked;

    return {
        trigger: isRegex ? new RegExp(triggerInput.value) : triggerInput.value,
        replacement: replacementInput.value,
        description: descInput.value,
        options: opts,
        isRegex
    };
};
