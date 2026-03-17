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
    wordByInput: new WeakMap(),
    inputByWordId: new Map(),
    bootstrapped: false
  };

  let observer = null;
  let queued = false;

  const normalize = (s) => (s || '').replace(/\s+/g, ' ').trim();

  function isWordLike(text) {
    return /^[a-zA-Z][a-zA-Z'’-]{0,20}$/.test(text);
  }

  function deepFindAll(predicate) {
    const out = [];

    function walk(root) {
      const tree = root instanceof ShadowRoot ? root : root;
      const elements = tree.querySelectorAll ? Array.from(tree.querySelectorAll('*')) : [];
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
      if (items.length < 4) continue;
      const words = items.map((li) => normalize(li.textContent));
      if (words.every((w) => w && isWordLike(w))) {
        return items;
      }
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

    if (!input.dataset.wuepBound) {
      input.addEventListener('focus', () => {
        state.activeInput = input;
      });
      input.addEventListener('input', () => {
        const assigned = getAssignedWord(input);
        const value = readInputText(input);

        if (!value) {
          releaseWordFromInput(input);
          updateClearButton(input);
          return;
        }

        if (assigned && value.toLowerCase() !== assigned.text.toLowerCase()) {
          releaseWordFromInput(input);
        }

        updateClearButton(input);
      });
      input.dataset.wuepBound = '1';
    }
  }

  function getClearBtn(input) {
    return input.closest('.wuep-input-wrap')?.querySelector('.wuep-clear-btn') || null;
  }

  function setInputValue(input, value) {
    if (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) {
      input.value = value;
    } else if (input instanceof HTMLElement && input.getAttribute('contenteditable') === 'true') {
      input.textContent = value;
    }

    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function getAssignedWord(input) {
    return state.wordByInput.get(input) || null;
  }

  function markWordUsed(wordId, used) {
    const item = state.wordItems.find((w) => w.id === wordId);
    if (!item) return;
    item.el.classList.toggle('wuep-word-used', used);
    item.used = used;
  }

  function releaseWordFromInput(input) {
    const assigned = getAssignedWord(input);
    if (!assigned) return;

    state.wordByInput.delete(input);
    state.inputByWordId.delete(assigned.id);
    markWordUsed(assigned.id, false);
  }

  function readInputText(input) {
    if (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) return normalize(input.value);
    if (input instanceof HTMLElement && input.getAttribute('contenteditable') === 'true') return normalize(input.textContent);
    return '';
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
  }

  function assignWordToInput(word, input) {
    if (!input || !word) return;

    const previousInput = state.inputByWordId.get(word.id);
    if (previousInput && previousInput !== input) {
      clearInput(previousInput);
    }

    releaseWordFromInput(input);

    state.wordByInput.set(input, word);
    state.inputByWordId.set(word.id, input);
    markWordUsed(word.id, true);

    setInputValue(input, word.text);
    updateClearButton(input);
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
  }

  function installWordInteractions(items) {
    state.wordItems = items.map((li, idx) => {
      const text = normalize(li.textContent);
      const id = `${idx}:${text.toLowerCase()}`;
      li.classList.add('wuep-word-item');
      li.addEventListener('click', () => handleWordClick({ id, text, el: li }), { passive: true });
      return { id, text, el: li, used: false };
    });
  }

  function reconcileAssignments() {
    const inputs = findInputs();
    inputs.forEach((input) => {
      wrapInput(input);
      updateClearButton(input);
    });
  }

  function init() {
    if (!state.enabled) {
      window.__wuepExerciseProbe = 'disabled';
      return;
    }

    const items = findWordList();
    if (!items.length) {
      window.__wuepExerciseProbe = 'snacks-no-word-list-yet';
      return;
    }

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

    // New exercise screen can replace DOM; remount if no tracked word items remain.
    if (!state.wordItems.some((w) => document.contains(w.el))) {
      state.wordItems = [];
      state.wordByInput = new WeakMap();
      state.inputByWordId.clear();
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
    state.enabled = enabled;
    if (!enabled) return;
    queueRefresh();
  }

  function bootstrap() {
    chrome.storage.sync.get([ENABLED_KEY], (res) => {
      if (typeof res?.[ENABLED_KEY] === 'boolean') {
        state.enabled = res[ENABLED_KEY];
      }

      startObserver();
      queueRefresh();

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
