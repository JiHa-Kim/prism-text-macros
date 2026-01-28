
let enabled = true;

chrome.commands.onCommand.addListener((command) => {
  if (command === "toggle-snips") {
    enabled = !enabled;
    // Notify active tab
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, { type: "TOGGLE_STATE", enabled });
      }
    });
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "GET_ENABLED") {
    sendResponse({ enabled });
  }
});
