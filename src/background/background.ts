
let enabled = true;

chrome.commands.onCommand.addListener((command) => {
  if (command === "toggle-snips") {
    enabled = !enabled;
    // Navigate to active tab
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, { type: "TOGGLE_STATE", enabled }).catch(() => {
          // Ignore if receiving end does not exist
        });
      }
    });
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "GET_ENABLED") {
    sendResponse({ enabled });
  } else if (msg && msg.type === "MACROS_UPDATED") {
    // Broadcast to all tabs
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach((tab) => {
        if (tab.id) {
          chrome.tabs.sendMessage(tab.id, { type: "MACROS_UPDATED" }).catch(() => {
            // Ignore if receiving end does not exist (page doesn't have content script)
          });
        }
      });
    });
  }
});
