import {
  normalize,
  extractDisplayPunctuation,
  parseTokens,
  parseInputTokens,
  toSentence,
  remapWithBaseCasing
} from './text.js';

const INPUT_SELECTOR = 'snack-gap .input[contenteditable="true"], snack-gap [contenteditable="true"], snack-gap input[type="text"], snack-gap textarea';

export function createReorderMode({ document, getStorage, pathname, readInputText, setInputValue }) {
  // Capture the route once, as the original content script did before SPA navigation.
  const storageKey = `wuep_reorder_state:${pathname}`;
  let items = [];

  function findItems() {
    return Array.from(document.querySelectorAll('.fill-container'))
      .map((container) => {
        const textEl = Array.from(container.querySelectorAll('.question-text')).find((el) => (el.textContent || '').includes('|'));
        const inputEl = container.querySelector(INPUT_SELECTOR);
        return textEl && inputEl ? { container, textEl, inputEl } : null;
      })
      .filter(Boolean);
  }

  function loadPersisted() {
    try {
      const parsed = JSON.parse(getStorage().getItem(storageKey) || '{}');
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  function savePersisted() {
    try {
      const payload = {};
      items.forEach((item) => {
        payload[item.id] = item.tokens;
      });
      getStorage().setItem(storageKey, JSON.stringify(payload));
    } catch {
      // ignore
    }
  }

  function applyItemToInput(item) {
    setInputValue(item.inputEl, toSentence(item.tokens));
  }

  function readDragSource(event, item) {
    let payload = null;
    try {
      payload = JSON.parse(event.dataTransfer.getData('text/plain'));
    } catch {
      return null;
    }

    if (!payload || payload.itemId !== item.id) return null;
    const from = Number(payload.from);
    return Number.isInteger(from) ? from : null;
  }

  function moveToken(item, from, to) {
    const next = [...item.tokens];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    item.tokens = next;

    applyItemToInput(item);
    renderBank(item);
    savePersisted();
  }

  function bindChipDragEvents(chip, item, idx) {
    chip.addEventListener('dragstart', (event) => {
      chip.classList.add('wuep-dragging');
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', JSON.stringify({ itemId: item.id, from: idx }));
    });

    chip.addEventListener('dragend', () => {
      chip.classList.remove('wuep-dragging');
      item.bankEl.querySelectorAll('.wuep-drop-target').forEach((el) => el.classList.remove('wuep-drop-target'));
    });

    chip.addEventListener('dragover', (event) => {
      event.preventDefault();
      chip.classList.add('wuep-drop-target');
    });

    chip.addEventListener('dragleave', () => chip.classList.remove('wuep-drop-target'));

    chip.addEventListener('drop', (event) => {
      event.preventDefault();
      chip.classList.remove('wuep-drop-target');

      const from = readDragSource(event, item);
      const to = idx;
      if (from === null || !Number.isInteger(to) || from === to) return;
      moveToken(item, from, to);
    });
  }

  function bindBankDrop(item) {
    if (!item.bankEl.dataset.wuepDnDBound) {
      item.bankEl.addEventListener('dragover', (event) => {
        event.preventDefault();
      });

      item.bankEl.addEventListener('drop', (event) => {
        const target = event.target;
        if (target?.classList?.contains('wuep-reorder-chip')) return;

        const from = readDragSource(event, item);
        if (from === null) return;
        moveToken(item, from, item.tokens.length);
      });

      item.bankEl.dataset.wuepDnDBound = '1';
    }
  }

  function renderBank(item) {
    if (!item.bankEl) return;

    item.bankEl.innerHTML = '';
    item.tokens.forEach((token, idx) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'wuep-reorder-chip';
      chip.textContent = token;
      chip.draggable = true;
      chip.dataset.index = String(idx);
      bindChipDragEvents(chip, item, idx);
      item.bankEl.appendChild(chip);
    });

    bindBankDrop(item);
  }

  function mount() {
    const found = findItems();
    if (!found.length) return false;

    const persisted = loadPersisted();

    items = found.map(({ container, textEl, inputEl }, idx) => {
      container.classList.add('wuep-reorder-container');
      const raw = textEl ? textEl.textContent || '' : '';
      const baseTokens = parseTokens(raw);
      const id = `${idx}`;

      const savedTokens = Array.isArray(persisted[id]) ? persisted[id].map((x) => normalize(String(x))).filter((t) => t && t !== '.') : null;
      const inputExistingValue = readInputText(inputEl);
      const existingTokens = inputExistingValue ? parseInputTokens(inputExistingValue) : null;

      const hasSameTokenCount = (candidate) => Array.isArray(candidate) && candidate.length === baseTokens.length;

      let tokens = baseTokens;
      let keepCurrentInput = false;

      if (hasSameTokenCount(existingTokens)) {
        tokens = remapWithBaseCasing(existingTokens, baseTokens);
        keepCurrentInput = true;
      } else if (hasSameTokenCount(savedTokens)) {
        tokens = remapWithBaseCasing(savedTokens, baseTokens);
      }

      tokens = remapWithBaseCasing(tokens, baseTokens);

      if (textEl) {
        textEl.dataset.wuepOriginal = raw;
        textEl.textContent = extractDisplayPunctuation(raw);
      }

      let bankEl = container.querySelector('.wuep-reorder-bank');
      if (!bankEl) {
        bankEl = document.createElement('div');
        bankEl.className = 'wuep-reorder-bank';

        const anchor = container.querySelector('.fill-gap') || inputEl?.closest('.fill-gap') || inputEl?.parentElement;
        if (anchor && anchor.parentNode) {
          anchor.parentNode.insertBefore(bankEl, anchor.nextSibling);
        } else {
          container.appendChild(bankEl);
        }
      }

      return { id, container, textEl, inputEl, bankEl, tokens, keepCurrentInput };
    });

    items.forEach((item) => {
      renderBank(item);
      if (!item.keepCurrentInput) {
        applyItemToInput(item);
      }
    });
    savePersisted();
    return true;
  }

  function hasConnectedItems() {
    return items.some((item) => item.container?.isConnected);
  }

  function unmount() {
    items.forEach((item) => {
      item.container?.classList?.remove('wuep-reorder-container');

      if (item.textEl) {
        const original = item.textEl.dataset.wuepOriginal;
        if (typeof original === 'string') item.textEl.textContent = original;
        delete item.textEl.dataset.wuepOriginal;
      }

      if (item.bankEl?.parentNode) item.bankEl.remove();
    });

    items = [];
  }

  return { mount, hasConnectedItems, unmount };
}
