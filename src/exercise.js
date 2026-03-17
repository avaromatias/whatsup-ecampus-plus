(() => {
  window.__wuepExerciseProbe = 'script-loaded';

  const ENABLED_KEY = 'wuep_enabled';
  const ASSIGN_ATTR = 'data-wuep-word-id';

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
    boundInputs: new WeakMap(),
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

  function isVisibleElement(el) {
    if (!(el instanceof Element)) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    return el.getClientRects().length > 0;
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

    return candidates.filter((el) => isEditableTarget(el) && isVisibleElement(el));
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

  function setCaretToEnd(input) {
    try {
      if (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) {
        const pos = input.value.length;
        input.setSelectionRange(pos, pos);
      } else if (input instanceof HTMLElement && input.getAttribute('contenteditable') === 'true') {
        const sel = window.getSelection();
        if (!sel) return;
        const range = document.createRange();
        range.selectNodeContents(input);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
      }
    } catch {
      // ignore
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

  function getClearBtn(input) {
    return input.closest('.wuep-input-wrap')?.querySelector('.wuep-clear-btn') || null;
  }

  function updateClearButton(input) {
    const btn = getClearBtn(input);
    if (!btn) return;
    btn.hidden = !readInputText(input);
  }

  function getAssignedWordId(input) {
    return input.getAttribute(ASSIGN_ATTR) || null;
  }

  function setAssignedWordId(input, wordId) {
    if (wordId) input.setAttribute(ASSIGN_ATTR, wordId);
    else input.removeAttribute(ASSIGN_ATTR);
  }

  function recomputeAssignmentsAndUsage() {
    state.assignmentByInput = new WeakMap();
    state.usageByWordId.clear();

    const validIds = new Set(state.wordItems.map((w) => w.id));

    findInputs().forEach((input) => {
      const value = readInputText(input);
      const wordId = getAssignedWordId(input);

      if (!value || !wordId || !validIds.has(wordId)) {
        setAssignedWordId(input, null);
        return;
      }

      state.assignmentByInput.set(input, { wordId });
      state.usageByWordId.set(wordId, (state.usageByWordId.get(wordId) || 0) + 1);
    });
  }

  function clearAssignment(input) {
    state.assignmentByInput.delete(input);
    setAssignedWordId(input, null);
  }

  function clearInput(input) {
    if (!input) return;
    clearAssignment(input);
    setInputValue(input, '');
    updateClearButton(input);
    recomputeAssignmentsAndUsage();
    updateWordVisualState();
  }

  function styleBadgeElement(badge) {
    badge.style.position = 'absolute';
    badge.style.top = '-6px';
    badge.style.right = '-6px';
    badge.style.minWidth = '16px';
    badge.style.height = '16px';
    badge.style.borderRadius = '999px';
    badge.style.background = '#ef4444';
    badge.style.color = '#fff';
    badge.style.fontSize = '10px';
    badge.style.lineHeight = '16px';
    badge.style.textAlign = 'center';
    badge.style.padding = '0 4px';
    badge.style.fontWeight = '700';
    badge.style.boxShadow = '0 0 0 2px #fff';
    badge.style.pointerEvents = 'none';
    badge.style.display = 'none';
  }

  function renderWordBadge(item, count) {
    const badge = item.badgeEl;
    if (!badge) return;
    const visible = count > 1;
    badge.hidden = !visible;
    badge.style.display = visible ? 'inline-block' : 'none';
    badge.textContent = visible ? String(count) : '';
  }

  function updateWordVisualState() {
    state.wordItems.forEach((item) => {
      const count = state.usageByWordId.get(item.id) || 0;
      const used = count > 0;
      item.used = used;

      item.el.classList.toggle('wuep-word-used', used);
      item.el.style.opacity = used ? '0.45' : '';
      item.el.style.textDecoration = used ? 'line-through' : '';
      item.el.style.filter = used ? 'grayscale(0.35)' : '';

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
        if (!readInputText(input)) {
          clearAssignment(input);
        }
        updateClearButton(input);
        recomputeAssignmentsAndUsage();
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
    if (!wrap || !wrap.parentNode) return;
    wrap.parentNode.insertBefore(input, wrap);
    wrap.remove();
  }

  function findWordById(wordId) {
    return state.wordItems.find((w) => w.id === wordId) || null;
  }

  function assignWordToInput(word, input) {
    if (!word || !input) return;

    const previousWordId = getAssignedWordId(input);
    const targetAlreadyUsesThisWord = previousWordId === word.id;

    const usage = state.usageByWordId.get(word.id) || 0;
    const wordAlreadyUsedElsewhere = usage > 0 && !targetAlreadyUsesThisWord;
    if (wordAlreadyUsedElsewhere) return;

    setAssignedWordId(input, word.id);
    state.assignmentByInput.set(input, { wordId: word.id });

    setInputValue(input, word.text);
    updateClearButton(input);

    recomputeAssignmentsAndUsage();
    updateWordVisualState();
  }

  function handleWordClick(word) {
    if (!state.enabled) return;

    let target = state.activeInput;
    if (!target || !target.isConnected) target = findInputs()[0] || null;
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
      if (!li.style.position) li.style.position = 'relative';
      li.style.cursor = 'pointer';
      li.style.userSelect = 'none';

      let badge = li.querySelector('.wuep-word-badge');
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'wuep-word-badge';
        badge.hidden = true;
        li.appendChild(badge);
      }
      styleBadgeElement(badge);

      const payload = { id, text, el: li };
      const onClick = () => handleWordClick(payload);
      li.addEventListener('click', onClick, { passive: true });

      return { id, text, el: li, used: false, onClick, badgeEl: badge };
    });
  }

  function cleanupWordInteractions() {
    state.wordItems.forEach((item) => {
      item.el.classList.remove('wuep-word-item', 'wuep-word-used');
      item.el.style.opacity = '';
      item.el.style.textDecoration = '';
      item.el.style.filter = '';
      item.el.style.cursor = '';
      item.el.style.userSelect = '';

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

  function reconcileUI() {
    const inputs = findInputs();
    inputs.forEach((input) => {
      wrapInput(input);
      updateClearButton(input);
    });

    recomputeAssignmentsAndUsage();
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
    reconcileUI();

    state.bootstrapped = true;
    window.__wuepExerciseProbe = 'snacks-mounted';
  }

  function refreshIfNeeded() {
    if (!state.enabled) return;

    if (!state.bootstrapped) {
      init();
      return;
    }

    if (!state.wordItems.some((w) => w.el.isConnected)) {
      state.bootstrapped = false;
      init();
      return;
    }

    reconcileUI();
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
      if (typeof res?.[ENABLED_KEY] === 'boolean') state.enabled = res[ENABLED_KEY];

      startObserver();
      if (state.enabled) queueRefresh();
      else teardownUI();

      if (chrome?.storage?.onChanged) {
        chrome.storage.onChanged.addListener((changes, area) => {
          if (area !== 'sync') return;
          if (changes[ENABLED_KEY]) setEnabled(Boolean(changes[ENABLED_KEY].newValue));
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
