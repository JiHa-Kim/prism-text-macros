import { Macro } from './types';
import { defaultSnippets } from './defaultSnippets';

export const loadMacrosFromStorage = async (storageArea: chrome.storage.StorageArea): Promise<Macro[]> => {
    return new Promise((resolve, reject) => {
        storageArea.get(["snips"], (result) => {
            if (chrome.runtime.lastError) {
                return reject(chrome.runtime.lastError);
            }

            if (result.snips && Array.isArray(result.snips)) {
                 // Return raw data
                 resolve(result.snips);
            } else {
                 // Check backup if generic logic? 
                 // Actually content.ts falls back to sync if local is empty.
                 if (storageArea === chrome.storage.local) {
                     // Try sync
                     chrome.storage.sync.get(["snips"], (resSync) => {
                         if (resSync.snips && Array.isArray(resSync.snips)) {
                             resolve(resSync.snips);
                         } else {
                             // Default
                             resolve(defaultSnippets as Macro[]);
                         }
                     });
                 } else {
                     resolve(defaultSnippets as Macro[]);
                 }
            }
        });
    });
};

export const saveMacrosToStorage = async (storageArea: chrome.storage.StorageArea, macros: Macro[]) => {
    // We assume macros here are already serialized if needed?
    // Or we handle serialization here?
    // Options.ts handles serialization before saving. Content.ts doesn't save.
    // So we just save what is passed.
    
    // However, to be safe, let's keep it simple:
    return new Promise<void>((resolve, reject) => {
        storageArea.set({ snips: macros }, () => {
             if (chrome.runtime.lastError) {
                 reject(chrome.runtime.lastError);
             } else {
                 resolve();
             }
        });
    });
};
