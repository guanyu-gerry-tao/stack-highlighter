/**
 * Background service worker.
 *
 * Its only job is side-panel plumbing: make the action button open the panel
 * and support explicit open requests from Chrome's action click event.
 */
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.windowId) return;
  await chrome.sidePanel.open({ windowId: tab.windowId });
});
