(() => {
  window.__wuepExerciseProbe = 'script-loaded';

  const ENABLED_KEY = 'wuep_enabled';
  if (!/\/snacks\//i.test(location.pathname)) {
    window.__wuepExerciseProbe = 'loaded-non-snacks';
    return;
  }
  window.__wuepExerciseProbe = 'loaded-snacks';

  const state = {
    enabled: true,
    activeInput: null,
    wordItems: [],
    assignmentByInput: new WeakMap(), // input -> { wordId }
    usageByWordId: new Map(),
    boundInputs: new WeakMap(), // input -> { onFocus, onInput }
    bootstrapped: false
  };

  let observer = null;
  let queued = false;

  const normalize = (s) => (s || '').replace(/\s+/g, ' ').trim();

  function isWordLike(text) {
    return /^[a-zA-Z][a-zA-Z'’-]{0,30}$/.test(text);
  }

  function deepFindAll(predicate) {
    const out = [];

    function walk(root) {
      const elements = root.querySelectorAll ? Array.from(root.querySelectorAll('*')) : [];
      elements.forEach((el) => {
        if (predicate(el)) out.push(el);
        if (el.shadowRoot) walk(el.shadowRoot);
      });
    }

    walk(document);
    return out;
  }

  function findWordList() {
    const lists = deepFindAll((el) => el.tagName === 'UL' || el.tagName === 'OL');

    for (const list of lists) {
      const items = Array.from(list.children).filter((c) => c.tagName === 'LI');
      if (items.length < 2) continue;
      const words = items.map((li) => normalize(li.textContent));
      if (words.every((w) => w && isWordLike(w))) return items;
    }

    return [];
  }

  function isEditableTarget(el) {
    if (!el) return false;
    if (el instanceof HTMLInputElement) return !el.disabled;
    if (el instanceof HTMLTextAreaElement) return !el.disabled;
    if (el instanceof HTMLElement && el.getAttribute('contenteditable') === 'true') return true;
    return false;
  }

  function findInputs() {
    const candidates = deepFindAll(
      (el) =>
        el.matches?.('input[type="text"], textarea, [contenteditable="true"]') ||
        el.getAttribute?.('contenteditable') === 'true'
    );

    return candidates.filter((el) => isEditableTarget(el) && el.offsetParent !== null);
  }

  function getUsage(wordId) {
    return state.usageByWordId.get(wordId) || 0;
  }

  function setUsage(wordId, count) {
    const safe = Math.max(0, count | 0);
    if (safe === 0) state.usageByWordId.delete(wordId);
    else state.usageByWordId.set(wordId, safe);
  }

  function bumpUsage(wordId, delta) {
    setUsage(wordId, getUsage(wordId) + delta);
  }

  function setCaretToEnd(input) {
    try {
      if (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) {
        const pos = input.value.length;
        input.setSelectionRange(pos, pos);
      } else if (input instanceof HTMLElement && input.getAttribute('contenteditable') === 'true') {
        const selection = window.getSelection();
        if (!selection) return;
        const range = document.createRange();
        range.selectNodeContents(input);
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
      }
    } catch {
      // no-op
    }
  }

  function setInputValue(input, value) {
    if (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) {
      input.value = value;
    } else if (input instanceof HTMLElement && input.getAttribute('contenteditable') === 'true') {
      input.textContent = value;
    }

    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    setCaretToEnd(input);
  }

  function readInputText(input) {
    if (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) return normalize(input.value);
    if (input instanceof HTMLElement && input.getAttribute('contenteditable') === 'true') return normalize(input.textContent);
    return '';
  }

  function getAssignedWord(input) {
    return state.assignmentByInput.get(input) || null;
  }

  function assignMetaToInput(input, wordId) {
    state.assignmentByInput.set(input, { wordId });
  }

  function releaseWordFromInput(input) {
    const assigned = getAssignedWord(input);
    if (!assigned) return;

    state.assignmentByInput.delete(input);
    bumpUsage(assigned.wordId, -1);
  }

  function getClearBtn(input) {
    return input.closest('.wuep-input-wrap')?.querySelector('.wuep-clear-btn') || null;
  }

  function updateClearButton(input) {
    const btn = getClearBtn(input);
    if (!btn) return;
    btn.hidden = !readInputText(input);
  }

  function clearInput(input) {
    if (!input) return;
    releaseWordFromInput(input);
    setInputValue(input, '');
    updateClearButton(input);
    updateWordVisualState();
  }

  function getEmptyInputsCount() {
    return findInputs().filter((input) => !readInputText(input)).length;
  }

  function shouldMarkAsUsed() {
    const totalWords = state.wordItems.length;
    const emptyInputs = getEmptyInputsCount();

    // In reuse scenarios (less words than sentences), only start strike-through
    // when each remaining empty sentence maps 1:1 with remaining never-used words.
    const neverUsedWords = state.wordItems.filter((w) => getUsage(w.id) === 0).length;
    if (totalWords < emptyInputs) return neverUsedWords === emptyInputs;

    return true;
  }

  function renderWordBadge(item, count) {
    if (!item.badgeEl) return;
    item.badgeEl.hidden = count <= 0;
    item.badgeEl.textContent = String(count);
  }

  function updateWordVisualState() {
    const markUsed = shouldMarkAsUsed();

    state.wordItems.forEach((item) => {
      const count = getUsage(item.id);
      item.used = count > 0;
      item.el.classList.toggle('wuep-word-used', markUsed && count > 0);
      renderWordBadge(item, count);
    });
  }

  function wrapInput(input) {
    if (!input.closest('.wuep-input-wrap')) {
      const wrap = document.createElement('span');
      wrap.className = 'wuep-input-wrap';
      input.parentNode.insertBefore(wrap, input);
      wrap.appendChild(input);

      const clearBtn = document.createElement('button');
      clearBtn.type = 'button';
      clearBtn.className = 'wuep-clear-btn';
      clearBtn.textContent = '×';
      clearBtn.hidden = true;
      clearBtn.addEventListener('click', () => {
        clearInput(input);
        input.focus();
      });
      wrap.appendChild(clearBtn);
    }

    if (!state.boundInputs.get(input)) {
      const onFocus = () => {
        state.activeInput = input;
      };

      const onInput = () => {
        const value = readInputText(input);
        if (!value) releaseWordFromInput(input);
        updateClearButton(input);
        updateWordVisualState();
      };

      input.addEventListener('focus', onFocus);
      input.addEventListener('input', onInput);
      state.boundInputs.set(input, { onFocus, onInput });
      input.dataset.wuepBound = '1';
    }
  }

  function unwrapInput(input) {
    const bound = state.boundInputs.get(input);
    if (bound) {
      input.removeEventListener('focus', bound.onFocus);
      input.removeEventListener('input', bound.onInput);
      state.boundInputs.delete(input);
    }

    delete input.dataset.wuepBound;

    const wrap = input.closest('.wuep-input-wrap');
    if (!wrap) return;

    const parent = wrap.parentNode;
    if (!parent) return;
    parent.insertBefore(input, wrap);
    wrap.remove();
  }

  function assignWordToInput(word, input) {
    if (!input || !word) return;

    const previous = getAssignedWord(input);
    if (previous && previous.wordId !== word.id) {
      bumpUsage(previous.wordId, -1);
    }

    assignMetaToInput(input, word.id);
    bumpUsage(word.id, previous?.wordId === word.id ? 0 : 1);

    setInputValue(input, word.text);
    updateClearButton(input);
    updateWordVisualState();
  }

  function handleWordClick(word) {
    if (!state.enabled) return;

    let target = state.activeInput;
    if (!target || !document.contains(target)) {
      target = findInputs()[0] || null;
    }
    if (!target) return;

    assignWordToInput(word, target);
    target.focus();
    setCaretToEnd(target);
  }

  function installWordInteractions(items) {
    state.wordItems = items.map((li, idx) => {
      const text = normalize(li.textContent);
      const id = `${idx}:${text.toLowerCase()}`;

      li.classList.add('wuep-word-item');

      let badge = li.querySelector('.wuep-word-badge');
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'wuep-word-badge';
        badge.hidden = true;
        li.appendChild(badge);
      }

      const payload = { id, text, el: li };
      const onClick = () => handleWordClick(payload);
      li.addEventListener('click', onClick, { passive: true });

      return { id, text, el: li, used: false, onClick, badgeEl: badge };
    });
  }

  function cleanupWordInteractions() {
    state.wordItems.forEach((item) => {
      item.el.classList.remove('wuep-word-item', 'wuep-word-used');
      if (item.onClick) item.el.removeEventListener('click', item.onClick);
      if (item.badgeEl && item.badgeEl.parentNode === item.el) item.badgeEl.remove();
    });

    state.wordItems = [];
    state.usageByWordId.clear();
    state.assignmentByInput = new WeakMap();
  }

  function teardownUI() {
    cleanupWordInteractions();
    findInputs().forEach((input) => unwrapInput(input));
    state.activeInput = null;
    state.bootstrapped = false;
    window.__wuepExerciseProbe = 'disabled';
  }

  function reconcileAssignments() {
    const inputs = findInputs();
    inputs.forEach((input) => {
      wrapInput(input);
      updateClearButton(input);
    });
    updateWordVisualState();
  }

  function init() {
    if (!state.enabled) {
      teardownUI();
      return;
    }

    const items = findWordList();
    if (!items.length) {
      window.__wuepExerciseProbe = 'snacks-no-word-list-yet';
      return;
    }

    cleanupWordInteractions();
    installWordInteractions(items);
    reconcileAssignments();

    state.bootstrapped = true;
    window.__wuepExerciseProbe = 'snacks-mounted';
  }

  function refreshIfNeeded() {
    if (!state.enabled) return;

    if (!state.bootstrapped) {
      init();
      return;
    }

    if (!state.wordItems.some((w) => document.contains(w.el))) {
      state.bootstrapped = false;
      init();
      return;
    }

    reconcileAssignments();
  }

  function queueRefresh() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      refreshIfNeeded();
    });
  }

  function startObserver() {
    if (observer) observer.disconnect();
    observer = new MutationObserver(() => queueRefresh());
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function setEnabled(enabled) {
    const next = Boolean(enabled);
    if (state.enabled === next) return;

    state.enabled = next;
    if (!next) {
      teardownUI();
      return;
    }

    queueRefresh();
  }

  function bootstrap() {
    chrome.storage.sync.get([ENABLED_KEY], (res) => {
      if (typeof res?.[ENABLED_KEY] === 'boolean') {
        state.enabled = res[ENABLED_KEY];
      }

      startObserver();
      if (state.enabled) queueRefresh();
      else teardownUI();

      if (chrome?.storage?.onChanged) {
        chrome.storage.onChanged.addListener((changes, area) => {
          if (area !== 'sync') return;
          if (changes[ENABLED_KEY]) {
            setEnabled(Boolean(changes[ENABLED_KEY].newValue));
          }
        });
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
  } else {
    bootstrap();
  }
})();
