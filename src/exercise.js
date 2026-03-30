(() => {
  window.__wuepExerciseProbe = 'script-loaded';

  const ENABLED_KEY = 'wuep_enabled';
  const ASSIGN_ATTR = 'data-wuep-word-id';
  const REORDER_STORAGE_KEY = `wuep_reorder_state:${location.pathname}`;
  const REWRITE_PREFILL_ATTR = 'data-wuep-rewrite-prefilled';

  if (!/\/snacks\//i.test(location.pathname)) {
    window.__wuepExerciseProbe = 'loaded-non-snacks';
    return;
  }
  window.__wuepExerciseProbe = 'loaded-snacks';

  const state = {
    enabled: true,
    mode: null, // 'reorder' | 'rewrite' | 'word-list'
    bootstrapped: false,

    // word-list mode
    activeInput: null,
    wordItems: [],
    assignmentByInput: new WeakMap(),
    usageByWordId: new Map(),
    boundInputs: new WeakMap(),

    // reorder mode
    reorderItems: [],

    // rewrite mode
    rewriteItems: []
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

  // ------------------------
  // Reorder mode (Duolingo-style)
  // ------------------------

  function findReorderContainers() {
    return Array.from(document.querySelectorAll('.fill-container')).filter((container) => {
      const textEl = Array.from(container.querySelectorAll('.question-text')).find((el) => (el.textContent || '').includes('|'));
      const input = container.querySelector('snack-gap .input[contenteditable="true"], snack-gap [contenteditable="true"], snack-gap input[type="text"], snack-gap textarea');
      return Boolean(textEl && input);
    });
  }

  function cleanToken(token) {
    const leftTrimmed = normalize(token).replace(/^[¿?¡!.,;:]+/, '');
    return normalize(leftTrimmed);
  }

  function parseTokens(raw) {
    const cleaned = normalize(raw).replace(/^\?\s*/, '');
    return cleaned
      .split('|')
      .map((s) => cleanToken(s.replace(/^\?\s*/, '')))
      .filter(Boolean);
  }

  function parseInputTokens(raw) {
    const cleaned = normalize(raw)
      .replace(/^\?\s*/, '')
      .replace(/\?$/g, '')
      .replace(/\.$/g, '');

    return cleaned
      .split(/\s+/)
      .map((s) => cleanToken(s))
      .filter(Boolean);
  }

  function toSentence(tokens) {
    const next = [...tokens];
    if (next.length) {
      next[0] = next[0].charAt(0).toUpperCase() + next[0].slice(1);
    }
    return next.join(' ');
  }

  function remapWithBaseCasing(candidateTokens, baseTokens) {
    const pools = new Map();

    baseTokens.forEach((token) => {
      const key = token.toLowerCase();
      if (!pools.has(key)) pools.set(key, []);
      pools.get(key).push(token);
    });

    return candidateTokens.map((token) => {
      const key = token.toLowerCase();
      const pool = pools.get(key);
      if (pool && pool.length) return pool.shift();
      return token;
    });
  }

  function loadReorderPersisted() {
    try {
      const parsed = JSON.parse(localStorage.getItem(REORDER_STORAGE_KEY) || '{}');
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  function saveReorderPersisted() {
    try {
      const payload = {};
      state.reorderItems.forEach((item) => {
        payload[item.id] = item.tokens;
      });
      localStorage.setItem(REORDER_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // ignore
    }
  }

  function renderReorderBank(item) {
    if (!item.bankEl) return;

    item.bankEl.innerHTML = '';
    item.tokens.forEach((token, idx) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'wuep-reorder-chip';
      chip.textContent = token;
      chip.draggable = true;
      chip.dataset.index = String(idx);

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

        let payload = null;
        try {
          payload = JSON.parse(event.dataTransfer.getData('text/plain'));
        } catch {
          return;
        }

        if (!payload || payload.itemId !== item.id) return;
        const from = Number(payload.from);
        const to = idx;
        if (!Number.isInteger(from) || !Number.isInteger(to) || from === to) return;

        const next = [...item.tokens];
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
        item.tokens = next;

        applyReorderItemToInput(item);
        renderReorderBank(item);
        saveReorderPersisted();
      });

      item.bankEl.appendChild(chip);
    });

    if (!item.bankEl.dataset.wuepDnDBound) {
      item.bankEl.addEventListener('dragover', (event) => {
        event.preventDefault();
      });

      item.bankEl.addEventListener('drop', (event) => {
        const target = event.target;
        if (target?.classList?.contains('wuep-reorder-chip')) return;

        let payload = null;
        try {
          payload = JSON.parse(event.dataTransfer.getData('text/plain'));
        } catch {
          return;
        }

        if (!payload || payload.itemId !== item.id) return;
        const from = Number(payload.from);
        if (!Number.isInteger(from)) return;

        const next = [...item.tokens];
        const [moved] = next.splice(from, 1);
        next.push(moved);
        item.tokens = next;

        applyReorderItemToInput(item);
        renderReorderBank(item);
        saveReorderPersisted();
      });

      item.bankEl.dataset.wuepDnDBound = '1';
    }
  }

  function applyReorderItemToInput(item) {
    const sentence = toSentence(item.tokens);
    setInputValue(item.inputEl, sentence);
  }

  function mountReorderMode() {
    const containers = findReorderContainers();
    if (!containers.length) return false;

    const persisted = loadReorderPersisted();

    state.reorderItems = containers.map((container, idx) => {
      const textEl = Array.from(container.querySelectorAll('.question-text')).find((el) => (el.textContent || '').includes('|'));
      const inputEl = container.querySelector('snack-gap .input[contenteditable="true"], snack-gap [contenteditable="true"], snack-gap input[type="text"], snack-gap textarea');
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
        textEl.textContent = '?';
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

    state.reorderItems.forEach((item) => {
      renderReorderBank(item);
      if (!item.keepCurrentInput) {
        applyReorderItemToInput(item);
      }
    });
    saveReorderPersisted();

    state.mode = 'reorder';
    window.__wuepExerciseProbe = 'snacks-mounted-reorder';
    return true;
  }

  function teardownReorderMode() {
    state.reorderItems.forEach((item) => {
      item.container?.classList?.remove('wuep-reorder-container');

      if (item.textEl) {
        const original = item.textEl.dataset.wuepOriginal;
        if (typeof original === 'string') item.textEl.textContent = original;
        delete item.textEl.dataset.wuepOriginal;
      }

      if (item.bankEl?.parentNode) item.bankEl.remove();
    });

    state.reorderItems = [];
  }

  // ------------------------
  // Rewrite mode (sentence prefill)
  // ------------------------

  function findRewriteContainers() {
    return Array.from(document.querySelectorAll('.fill-container')).filter((container) => {
      const textEl = Array.from(container.querySelectorAll('.question-text')).find((el) => {
        const text = normalize(el.textContent);
        return text && !text.includes('|') && !/_{2,}/.test(text);
      });
      const inputEl = container.querySelector('snack-gap .input[contenteditable="true"], snack-gap [contenteditable="true"], snack-gap input[type="text"], snack-gap textarea');
      return Boolean(textEl && inputEl);
    });
  }

  function shouldEnableRewriteMode(containers) {
    if (!containers.length) return false;

    // Never run rewrite prefill in word-bank exercises.
    if (findWordList().length > 0) return false;

    // Defensive: avoid stepping into option-based/drag/drop snack variants.
    const hasChoiceLikeUi = Boolean(
      document.querySelector(
        '.wuep-reorder-bank, .fill-container .option, .fill-container [role="option"], .fill-container .drag, .fill-container .draggable, .fill-container .dropzone, .fill-container ul li, .fill-container ol li'
      )
    );
    if (hasChoiceLikeUi) return false;

    return true;
  }

  function extractRewriteSentence(textEl) {
    return normalize(textEl?.textContent || '');
  }

  function mountRewriteMode() {
    const containers = findRewriteContainers();
    if (!shouldEnableRewriteMode(containers)) return false;

    state.rewriteItems = containers.map((container, idx) => {
      const textEl = Array.from(container.querySelectorAll('.question-text')).find((el) => {
        const text = normalize(el.textContent);
        return text && !text.includes('|');
      });
      const inputEl = container.querySelector('snack-gap .input[contenteditable="true"], snack-gap [contenteditable="true"], snack-gap input[type="text"], snack-gap textarea');
      const sentence = extractRewriteSentence(textEl);

      if (inputEl && sentence && !readInputText(inputEl) && !inputEl.hasAttribute(REWRITE_PREFILL_ATTR)) {
        setInputValue(inputEl, sentence);
      }

      if (inputEl) inputEl.setAttribute(REWRITE_PREFILL_ATTR, '1');

      return { id: `${idx}`, container, textEl, inputEl, sentence };
    });

    state.mode = 'rewrite';
    window.__wuepExerciseProbe = 'snacks-mounted-rewrite';
    return true;
  }

  function teardownRewriteMode() {
    state.rewriteItems.forEach((item) => {
      item.inputEl?.removeAttribute(REWRITE_PREFILL_ATTR);
    });
    state.rewriteItems = [];
  }

  // ------------------------
  // Word-list mode (existing)
  // ------------------------

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

  function renderWordBadge(item, count) {
    const visible = count > 1;
    item.el.classList.toggle('wuep-word-has-badge', visible);
    if (visible) {
      item.el.setAttribute('data-wuep-usage', String(count));
    } else {
      item.el.removeAttribute('data-wuep-usage');
    }
  }

  function getEmptyInputsCount() {
    return findInputs().filter((input) => !readInputText(input)).length;
  }

  function shouldMarkWordsAsUsed() {
    const remainingInputs = getEmptyInputsCount();
    const availableWords = state.wordItems.filter((item) => (state.usageByWordId.get(item.id) || 0) === 0).length;
    return availableWords >= remainingInputs;
  }

  function updateWordVisualState() {
    const markAsUsed = shouldMarkWordsAsUsed();

    state.wordItems.forEach((item) => {
      const count = state.usageByWordId.get(item.id) || 0;
      const used = markAsUsed && count > 0;
      item.used = count > 0;

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
        if (!readInputText(input)) clearAssignment(input);
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

  function assignWordToInput(word, input) {
    if (!word || !input) return;

    const previousWordId = getAssignedWordId(input);
    const targetAlreadyUsesThisWord = previousWordId === word.id;
    const usage = state.usageByWordId.get(word.id) || 0;

    if (shouldMarkWordsAsUsed() && usage > 0 && !targetAlreadyUsesThisWord) {
      return;
    }

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

      li.querySelectorAll('.wuep-word-badge').forEach((badgeEl) => badgeEl.remove());

      const payload = { id, text, el: li };
      const onClick = () => handleWordClick(payload);
      li.addEventListener('click', onClick, { passive: true });

      return { id, text, el: li, used: false, onClick };
    });
  }

  function cleanupWordInteractions() {
    state.wordItems.forEach((item) => {
      item.el.classList.remove('wuep-word-item', 'wuep-word-used', 'wuep-word-has-badge');
      item.el.removeAttribute('data-wuep-usage');
      item.el.style.opacity = '';
      item.el.style.textDecoration = '';
      item.el.style.filter = '';
      item.el.style.cursor = '';
      item.el.style.userSelect = '';

      if (item.onClick) item.el.removeEventListener('click', item.onClick);
    });

    state.wordItems = [];
    state.usageByWordId.clear();
    state.assignmentByInput = new WeakMap();
  }

  function reconcileWordListMode() {
    const inputs = findInputs();
    inputs.forEach((input) => {
      wrapInput(input);
      updateClearButton(input);
    });

    recomputeAssignmentsAndUsage();
    updateWordVisualState();
  }

  function mountWordListMode() {
    const items = findWordList();
    if (!items.length) return false;

    cleanupWordInteractions();
    installWordInteractions(items);
    reconcileWordListMode();

    state.mode = 'word-list';
    window.__wuepExerciseProbe = 'snacks-mounted-word-list';
    return true;
  }

  // ------------------------
  // Lifecycle
  // ------------------------

  function teardownUI() {
    teardownReorderMode();
    teardownRewriteMode();
    cleanupWordInteractions();
    findInputs().forEach((input) => unwrapInput(input));

    state.activeInput = null;
    state.mode = null;
    state.bootstrapped = false;
    window.__wuepExerciseProbe = 'disabled';
  }

  function init() {
    if (!state.enabled) {
      teardownUI();
      return;
    }

    teardownUI();

    if (mountReorderMode()) {
      state.bootstrapped = true;
      return;
    }

    if (mountRewriteMode()) {
      state.bootstrapped = true;
      return;
    }

    if (mountWordListMode()) {
      state.bootstrapped = true;
      return;
    }

    window.__wuepExerciseProbe = 'snacks-no-known-pattern-yet';
  }

  function refreshIfNeeded() {
    if (!state.enabled) return;

    if (!state.bootstrapped) {
      init();
      return;
    }

    if (state.mode === 'reorder') {
      if (!state.reorderItems.some((item) => item.container?.isConnected)) {
        state.bootstrapped = false;
        init();
      }
      return;
    }

    if (state.mode === 'rewrite') {
      if (!state.rewriteItems.some((item) => item.container?.isConnected)) {
        state.bootstrapped = false;
        init();
      }
      return;
    }

    if (state.mode === 'word-list') {
      if (!state.wordItems.some((w) => w.el.isConnected)) {
        state.bootstrapped = false;
        init();
        return;
      }
      reconcileWordListMode();
      return;
    }

    state.bootstrapped = false;
    init();
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
