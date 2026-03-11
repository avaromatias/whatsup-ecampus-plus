const ENABLED_KEY = 'wuep_enabled';

const enabledInput = document.getElementById('enabled');
const statusEl = document.getElementById('status');

function setStatus(text) {
  statusEl.textContent = text;
}

chrome.storage.sync.get([ENABLED_KEY], (result) => {
  const enabled = typeof result?.[ENABLED_KEY] === 'boolean' ? result[ENABLED_KEY] : true;
  enabledInput.checked = enabled;
  setStatus(enabled ? 'Enhancements are enabled.' : 'Enhancements are disabled.');
});

enabledInput.addEventListener('change', () => {
  const enabled = enabledInput.checked;
  chrome.storage.sync.set({ [ENABLED_KEY]: enabled }, () => {
    setStatus(enabled ? 'Enhancements are enabled.' : 'Enhancements are disabled.');
  });
});
