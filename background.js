/* Reader Lite - background */

chrome.runtime.onInstalled.addListener(() => {
  chrome.action.setBadgeBackgroundColor({ color: '#3a7c4a' });
});

chrome.action.onClicked.addListener(async (tab) => {
  const tabId = tab?.id;
  const url = tab?.url || '';
  if (!tabId || !/^https?:\/\//i.test(url)) {
    return;
  }

  try {
    const response = await sendToTab(tabId, { action: 'toggleReaderMode' });
    setBadge(tabId, Boolean(response?.enabled));
  } catch (_error) {
    // Content script not injected (e.g. page opened before extension install/update)
    // Programmatically inject and retry
    try {
      await chrome.scripting.insertCSS({ target: { tabId }, files: ['content.css'] });
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
      const response = await sendToTab(tabId, { action: 'toggleReaderMode' });
      setBadge(tabId, Boolean(response?.enabled));
    } catch (_retryError) {
      setBadge(tabId, false);
    }
  }
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  await syncBadge(tabId);
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (changeInfo.status === 'complete') {
    await syncBadge(tabId);
  }
});

async function syncBadge(tabId) {
  try {
    const response = await sendToTab(tabId, { action: 'getReaderModeState' });
    setBadge(tabId, Boolean(response?.enabled));
  } catch (_error) {
    setBadge(tabId, false);
  }
}

function setBadge(tabId, enabled) {
  chrome.action.setBadgeText({ tabId, text: enabled ? '阅' : '' });
  chrome.action.setBadgeBackgroundColor({ tabId, color: enabled ? '#3a7c4a' : '#8a8a8a' });
  chrome.action.setTitle({
    tabId,
    title: enabled ? '关闭阅读模式' : '开启阅读模式',
  });
}

function sendToTab(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response);
    });
  });
}
