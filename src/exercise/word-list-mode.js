import { normalize } from './text.js';

const ASSIGN_ATTR = 'data-wuep-word-id';

function isWordLike(text) {
  // Answer banks can contain short phrases, not only single tokens.
  return /^[a-zA-Z][a-zA-Z'’-]{0,30}(?:\s+[a-zA-Z][a-zA-Z'’-]{0,30}){0,4}$/.test(text);
}

export function createWordListMode({ document, deepFindAll, findInputs, readInputText, setInputValue, setCaretToEnd, isEnabled }) {
  let activeInput = null;
  let words = [];
  const usageById = new Map();
  const boundInputs = new WeakMap();

  function findWords() {
    const lists = deepFindAll((el) => el.tagName === 'UL' || el.tagName === 'OL');
    const preferred = [];
    const remaining = [];
    lists.forEach((list) => {
      if (/\banswer\b/i.test(list.className || '')) preferred.push(list);
      else remaining.push(list);
    });

    for (const list of [...preferred, ...remaining]) {
      const items = Array.from(list.children).filter((child) => child.tagName === 'LI');
      if (items.length >= 2 && items.every((item) => {
        const text = normalize(item.textContent);
        return text && isWordLike(text);
      })) return items;
    }
    return [];
  }

  function assignedId(input) {
    return input.getAttribute(ASSIGN_ATTR) || null;
  }

  function setAssignedId(input, id) {
    if (id) input.setAttribute(ASSIGN_ATTR, id);
    else input.removeAttribute(ASSIGN_ATTR);
  }

  function clearAssignment(input) {
    setAssignedId(input, null);
  }

  function recomputeUsage() {
    usageById.clear();
    const validIds = new Set(words.map((word) => word.id));
    findInputs().forEach((input) => {
      const id = assignedId(input);
      if (!readInputText(input) || !id || !validIds.has(id)) {
        clearAssignment(input);
        return;
      }
      usageById.set(id, (usageById.get(id) || 0) + 1);
    });
  }

  function shouldMarkUsed() {
    const emptyCount = findInputs().filter((input) => !readInputText(input)).length;
    const unusedCount = words.filter((word) => !usageById.get(word.id)).length;
    return unusedCount >= emptyCount;
  }

  function renderUsage() {
    const markUsed = shouldMarkUsed();
    words.forEach(({ id, el }) => {
      const count = usageById.get(id) || 0;
      const used = markUsed && count > 0;
      el.classList.toggle('wuep-word-used', used);
      el.style.opacity = used ? '0.45' : '';
      el.style.textDecoration = used ? 'line-through' : '';
      el.style.filter = used ? 'grayscale(0.35)' : '';
      el.classList.toggle('wuep-word-has-badge', count > 1);
      if (count > 1) el.setAttribute('data-wuep-usage', String(count));
      else el.removeAttribute('data-wuep-usage');
    });
  }

  function refreshUsage() {
    recomputeUsage();
    renderUsage();
  }

  function updateClearButton(input) {
    const button = input.closest('.wuep-input-wrap')?.querySelector('.wuep-clear-btn');
    if (button) button.hidden = !readInputText(input);
  }

  function clearInput(input) {
    clearAssignment(input);
    setInputValue(input, '');
    updateClearButton(input);
    refreshUsage();
  }

  function wrapInput(input) {
    if (!input.closest('.wuep-input-wrap')) {
      const wrap = document.createElement('span');
      wrap.className = 'wuep-input-wrap';
      input.parentNode.insertBefore(wrap, input);
      wrap.appendChild(input);

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'wuep-clear-btn';
      button.textContent = '×';
      button.hidden = true;
      button.addEventListener('click', () => {
        clearInput(input);
        input.focus();
      });
      wrap.appendChild(button);
    }

    if (boundInputs.has(input)) return;
    const onFocus = () => { activeInput = input; };
    const onInput = () => {
      if (!readInputText(input)) clearAssignment(input);
      updateClearButton(input);
      refreshUsage();
    };
    input.addEventListener('focus', onFocus);
    input.addEventListener('input', onInput);
    boundInputs.set(input, { onFocus, onInput });
    input.dataset.wuepBound = '1';
  }

  function unwrapInput(input) {
    const bound = boundInputs.get(input);
    if (bound) {
      input.removeEventListener('focus', bound.onFocus);
      input.removeEventListener('input', bound.onInput);
      boundInputs.delete(input);
    }
    delete input.dataset.wuepBound;
    const wrap = input.closest('.wuep-input-wrap');
    if (!wrap?.parentNode) return;
    wrap.parentNode.insertBefore(input, wrap);
    wrap.remove();
  }

  function nextFillTarget() {
    const inputs = findInputs();
    if (!inputs.length) return null;
    const focused = inputs.includes(document.activeElement) ? document.activeElement : null;
    if (focused) return focused;

    const active = activeInput?.isConnected ? activeInput : null;
    if (active && !readInputText(active)) return active;
    if (active) {
      const index = inputs.indexOf(active);
      if (index >= 0) {
        const following = inputs.slice(index + 1).find((input) => !readInputText(input));
        if (following) return following;
      }
    }
    return inputs.find((input) => !readInputText(input)) || null;
  }

  function assignWord(word, input) {
    const alreadyAssigned = assignedId(input) === word.id;
    if (shouldMarkUsed() && usageById.get(word.id) > 0 && !alreadyAssigned) return false;

    setAssignedId(input, word.id);
    setInputValue(input, word.text);
    updateClearButton(input);
    refreshUsage();
    return true;
  }

  function handleWordClick(word) {
    if (!isEnabled()) return;
    const target = nextFillTarget();
    if (!target || !assignWord(word, target)) return;

    const inputs = findInputs();
    const index = inputs.indexOf(target);
    const nextEmpty = index >= 0 ? inputs.slice(index + 1).find((input) => !readInputText(input)) : null;
    activeInput = nextEmpty || target;
    activeInput.focus();
    setCaretToEnd(activeInput);
  }

  function bindWord(item, index) {
    const text = normalize(item.textContent);
    const word = { id: `${index}:${text.toLowerCase()}`, text, el: item };
    item.classList.add('wuep-word-item');
    if (!item.style.position) item.style.position = 'relative';
    item.style.cursor = 'pointer';
    item.style.userSelect = 'none';
    item.querySelectorAll('.wuep-word-badge').forEach((badge) => badge.remove());
    word.onClick = () => handleWordClick(word);
    item.addEventListener('click', word.onClick, { passive: true });
    return word;
  }

  function unbindWords() {
    words.forEach(({ el, onClick }) => {
      el.classList.remove('wuep-word-item', 'wuep-word-used', 'wuep-word-has-badge');
      el.removeAttribute('data-wuep-usage');
      el.style.opacity = '';
      el.style.textDecoration = '';
      el.style.filter = '';
      el.style.cursor = '';
      el.style.userSelect = '';
      el.removeEventListener('click', onClick);
    });
    words = [];
    usageById.clear();
  }

  function reconcile() {
    findInputs().forEach((input) => {
      wrapInput(input);
      updateClearButton(input);
    });
    refreshUsage();
  }

  function mount() {
    const items = findWords();
    if (!items.length) return false;
    unbindWords();
    words = items.map(bindWord);
    reconcile();
    return true;
  }

  function hasConnectedItems() {
    return words.some((word) => word.el.isConnected);
  }

  function unmount() {
    unbindWords();
    findInputs().forEach(unwrapInput);
    activeInput = null;
  }

  return { findWords, mount, hasConnectedItems, reconcile, unmount };
}
