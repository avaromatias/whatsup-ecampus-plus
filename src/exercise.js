import { normalize } from './exercise/text.js';
import { createReorderMode } from './exercise/reorder-mode.js';
import { createRewriteMode } from './exercise/rewrite-mode.js';
import { createWordListMode } from './exercise/word-list-mode.js';
import { tokenizeWords, answerFromScript } from './exercise/situation-match.js';
import { createSituationPanel } from './exercise/situation-panel.js';

(() => {
  window.__wuepExerciseProbe = 'script-loaded';

  const ENABLED_KEY = 'wuep_enabled';
  const HELPERS_PREFIX = 'wuep_helpers:';
  const COMPLETE_ALL_ID = 'wuep-complete-all';
  const COMPLETE_ROW_CLASS = 'wuep-complete-row';

  window.__wuepExerciseProbe = /\/snacks\//i.test(location.pathname) ? 'loaded-snacks' : 'loaded-non-snacks';

  const state = {
    enabled: true,
    mode: null, // 'reorder' | 'rewrite' | 'word-list'
    bootstrapped: false,

    // situation / speech-lab helpers
    situationScript: [],
    speechStatements: [],
    speechPrefillItems: [],
    situationGapItems: []
  };

  const reorderMode = createReorderMode({ document, getStorage: () => localStorage, pathname: location.pathname, readInputText, setInputValue });
  const wordListMode = createWordListMode({ document, deepFindAll, findInputs, readInputText, setInputValue, setCaretToEnd, isEnabled: () => state.enabled });
  const rewriteMode = createRewriteMode({ document, hasWordList: () => wordListMode.findWords().length > 0, readInputText, setInputValue });
  const situationPanel = createSituationPanel({ document, window, getStorage: () => sessionStorage });

  let observer = null;
  let queued = false;

  function isSnacksPath() {
    return /\/snacks\//i.test(location.pathname);
  }

  function getSnackPathId() {
    const parts = location.pathname.split('/').filter(Boolean);
    return parts[0] === 'snacks' ? parts[1] || '' : '';
  }

  function getSnackPageId() {
    const parts = location.pathname.split('/').filter(Boolean);
    return parts[0] === 'snacks' ? parts[2] || '' : '';
  }

  function helpersStorageKey(snackId) {
    const id = snackId || getSnackPathId();
    return id ? `${HELPERS_PREFIX}${id}` : '';
  }

  function isSpeechLabPath() {
    return /SPEECHLAB/i.test(getSnackPageId());
  }

  function isSpeechLabRecordPage() {
    return /SPEECHLAB/i.test(getSnackPageId()) && /_LAB/i.test(getSnackPageId());
  }

  function isSpeechLabDictationPage() {
    return isSpeechLabPath() && !/_LAB/i.test(getSnackPageId());
  }

  function isSituationQuestionPage() {
    const pageId = getSnackPageId();
    return /VIDEO/i.test(pageId) && /_SNACK/i.test(pageId);
  }

  function isSituationScriptPage() {
    return /VIDEO/i.test(getSnackPageId()) && /SCRIPT/i.test(getSnackPageId());
  }

  function loadHelpersCache(snackId) {
    const key = helpersStorageKey(snackId);
    if (!key) return null;
    try {
      const parsed = JSON.parse(sessionStorage.getItem(key) || 'null');
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }

  function saveHelpersCache(helpers, snackId) {
    const key = helpersStorageKey(snackId || helpers?.snackId);
    if (!key || !helpers) return;
    try {
      const current = loadHelpersCache(snackId || helpers.snackId) || {};
      const next = {
        snackId: helpers.snackId || current.snackId || getSnackPathId(),
        situationScript: helpers.situationScript?.length ? helpers.situationScript : current.situationScript || [],
        speechStatements: mergeSpeechStatements(helpers.speechStatements, current.speechStatements)
      };
      sessionStorage.setItem(key, JSON.stringify(next));
      applyHelpersCache(next);
    } catch {
      // ignore
    }
  }

  function isCleanSpeechStatement(value) {
    const text = normalize(value);
    if (!text) return false;
    if (/listen:|repeat:/i.test(text)) return false;
    return text.length >= 8;
  }

  function mergeSpeechStatements(incoming, current) {
    const cleanIncoming = (incoming || []).map(normalize).filter(isCleanSpeechStatement);
    if (cleanIncoming.length) return cleanIncoming;
    const cleanCurrent = (current || []).map(normalize).filter(isCleanSpeechStatement);
    if (cleanCurrent.length) return cleanCurrent;
    return (incoming || []).map(normalize).filter(Boolean);
  }

  function applyHelpersCache(helpers) {
    if (!helpers) return;
    if (Array.isArray(helpers.situationScript) && helpers.situationScript.length) {
      state.situationScript = helpers.situationScript;
    }
    if (Array.isArray(helpers.speechStatements) && helpers.speechStatements.length) {
      state.speechStatements = mergeSpeechStatements(helpers.speechStatements, state.speechStatements);
    }
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

  function createSparkleIcon() {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('aria-hidden', 'true');
    svg.classList.add('wuep-complete-icon');

    const wand = document.createElementNS(ns, 'path');
    wand.setAttribute('d', 'M2.6 13.6 9.2 7');
    wand.setAttribute('fill', 'none');
    wand.setAttribute('stroke', 'currentColor');
    wand.setAttribute('stroke-width', '1.7');
    wand.setAttribute('stroke-linecap', 'round');

    const star = document.createElementNS(ns, 'path');
    star.setAttribute('d', 'M11.2 1.2 12 4.1 14.9 4.9 12 5.7 11.2 8.6 10.4 5.7 7.5 4.9 10.4 4.1Z');

    const spark = document.createElementNS(ns, 'path');
    spark.setAttribute('d', 'M14.15 8.35 14.55 9.55 15.75 9.95 14.55 10.35 14.15 11.55 13.75 10.35 12.55 9.95 13.75 9.55Z');

    svg.append(wand, star, spark);
    return svg;
  }

  function createCompleteOneButton(onComplete, enabled = true) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'wuep-complete-one';
    button.title = enabled ? 'Auto-complete this answer' : 'No matching line in the script';
    button.setAttribute('aria-label', button.title);
    button.disabled = !enabled;
    button.appendChild(createSparkleIcon());
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!button.disabled) onComplete();
    });
    return button;
  }

  function mountControlCompleteButton(control, onComplete, enabled = true) {
    if (!control || control.dataset.wuepCompleteBound === '1') return;
    const host = isSituationQuestionPage()
      ? control.closest('.fill-gap') || control.closest('.fill-container') || control.closest('snack-gap') || control
      : control.closest('snack-gap') || control;
    if (host.parentElement?.classList.contains(COMPLETE_ROW_CLASS)) {
      control.dataset.wuepCompleteBound = '1';
      return;
    }

    const parent = host.parentNode;
    if (!parent) return;

    const row = document.createElement('span');
    row.className = COMPLETE_ROW_CLASS;
    parent.insertBefore(row, host);
    row.appendChild(host);
    row.appendChild(createCompleteOneButton(onComplete, enabled));
    control.dataset.wuepCompleteBound = '1';
  }

  function findCompleteAllAnchor() {
    return document.querySelector('main form, form, main .snack, main');
  }

  function ensureCompleteAllButton(onClick) {
    if (document.getElementById(COMPLETE_ALL_ID)) return;

    const anchor = findCompleteAllAnchor();
    if (!anchor?.parentNode) return;

    const bar = document.createElement('div');
    bar.className = 'wuep-complete-bar';

    const button = document.createElement('button');
    button.id = COMPLETE_ALL_ID;
    button.type = 'button';
    button.className = 'wuep-complete-all';
    button.textContent = 'Auto-complete all';
    button.addEventListener('click', (event) => {
      event.preventDefault();
      onClick();
    });

    bar.appendChild(button);
    anchor.parentNode.insertBefore(bar, anchor);
  }

  function teardownCompleteUi() {
    document.querySelector('.wuep-complete-bar')?.remove();
    document.querySelectorAll(`.${COMPLETE_ROW_CLASS}`).forEach((row) => {
      const parent = row.parentNode;
      if (!parent) {
        row.remove();
        return;
      }
      while (row.firstChild) {
        const child = row.firstChild;
        if (child.classList?.contains('wuep-complete-one')) child.remove();
        else parent.insertBefore(child, row);
      }
      row.remove();
    });
    findInputs().forEach((input) => {
      delete input.dataset.wuepCompleteBound;
    });
  }

  // ------------------------
  // Situation script panel
  // ------------------------

  function scrapeSituationScriptFromDom() {
    const rows = deepFindAll((el) => el.matches?.('.table.dialog .row, .dialog .row'));
    if (!rows.length) return [];

    const lines = [];
    const seen = new Set();
    rows.forEach((row) => {
      const speaker = normalize(row.querySelector('.cell.person, .person')?.textContent);
      const cells = Array.from(row.querySelectorAll('.cell'));
      const lineCell = cells.find((cell) => !cell.classList.contains('person')) || cells[1] || null;
      const line = normalize(lineCell?.textContent);
      const key = `${speaker}::${line}`;
      if (!line || seen.has(key)) return;
      seen.add(key);
      lines.push({ speaker, line });
    });
    return lines;
  }

  function captureSituationScriptIfPresent() {
    if (!isSituationScriptPage()) return;
    const lines = scrapeSituationScriptFromDom();
    if (!lines.length) return;
    saveHelpersCache({ snackId: getSnackPathId(), situationScript: lines, speechStatements: state.speechStatements });
  }

  function getControlOptions(control) {
    if (control instanceof HTMLSelectElement) {
      return Array.from(control.options)
        .map((option) => normalize(option.textContent || option.value))
        .filter(Boolean);
    }

    const listId = control.getAttribute('aria-controls');
    if (listId) {
      const list = document.getElementById(listId);
      if (list) {
        return Array.from(list.querySelectorAll('[role="option"]'))
          .map((option) => normalize(option.textContent))
          .filter(Boolean);
      }
    }

    const container = control.closest('.fill-container');
    return Array.from(container?.querySelectorAll('[role="option"], .option') || [])
      .map((option) => normalize(option.textContent))
      .filter(Boolean);
  }

  function isFeedbackText(value) {
    return /^(correct|incorrect|wrong)$/i.test(normalize(value));
  }

  function getGapContext(control) {
    const container = control.closest('.fill-container');
    const host = control.closest('snack-gap') || control;
    let left = '';
    let right = '';

    Array.from(container?.querySelectorAll('.question-text') || []).forEach((el) => {
      const text = normalize(el.textContent);
      if (!text || isFeedbackText(text)) return;
      const position = host.compareDocumentPosition(el);
      if (position & Node.DOCUMENT_POSITION_PRECEDING) left = normalize(`${left} ${text}`);
      if (position & Node.DOCUMENT_POSITION_FOLLOWING) right = normalize(`${right} ${text}`);
    });

    return { left, right, options: getControlOptions(control) };
  }

  function setControlValue(control, value) {
    if (!control || !value) return false;

    if (control instanceof HTMLSelectElement) {
      const match = Array.from(control.options).find((option) => {
        const label = tokenizeWords(option.textContent || option.value).join(' ');
        return label === tokenizeWords(value).join(' ');
      });
      if (!match) return false;
      control.value = match.value;
      control.dispatchEvent(new Event('input', { bubbles: true }));
      control.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }

    if (control.getAttribute('role') === 'combobox' || control.getAttribute('aria-haspopup') === 'listbox') {
      const target = tokenizeWords(value).join(' ');
      control.click();
      const option = deepFindAll((el) => el.matches?.('[role="option"]')).find(
        (el) => tokenizeWords(el.textContent).join(' ') === target
      );
      if (option) {
        option.click();
        return true;
      }
    }

    setInputValue(control, value);
    return true;
  }

  function findSituationFillControls() {
    if (!isSituationQuestionPage()) return [];
    return Array.from(document.querySelectorAll('.fill-container'))
      .map((container) =>
        container.querySelector(
          'snack-gap [contenteditable="true"], snack-gap input, snack-gap textarea, snack-gap select, select, [role="combobox"]'
        )
      )
      .filter(Boolean);
  }

  function applySituationGap(item) {
    if (!item?.control || !item.answer) return;
    setControlValue(item.control, item.answer);
  }

  function mountSituationAutocomplete() {
    const controls = findSituationFillControls();
    if (!controls.length || !state.situationScript.length) {
      state.situationGapItems = [];
      return false;
    }

    state.situationGapItems = controls.map((control) => {
      const { left, right, options } = getGapContext(control);
      const answer = answerFromScript(state.situationScript, left, right, options);
      mountControlCompleteButton(control, () => setControlValue(control, answer), Boolean(answer));
      return { control, answer };
    });

    ensureCompleteAllButton(() => {
      state.situationGapItems.forEach(applySituationGap);
    });
    return true;
  }

  function teardownSituationAutocomplete() {
    state.situationGapItems = [];
  }

  function mountSituationScriptPanel() {
    if (!isSituationQuestionPage()) {
      teardownSituationScriptPanel();
      return false;
    }
    if (!state.situationScript.length) applyHelpersCache(loadHelpersCache());
    if (!state.situationScript.length) {
      teardownSituationScriptPanel();
      return false;
    }

    situationPanel.mount(state.situationScript);

    mountSituationAutocomplete();
    state.mode = 'situation-script';
    window.__wuepExerciseProbe = 'snacks-mounted-situation-script';
    return true;
  }

  function teardownSituationScriptPanel() {
    situationPanel.unmount();
  }

  // ------------------------
  // Speech Lab dictation helper
  // ------------------------

  function scrapeSpeechStatementsFromDom() {
    const statements = [];
    const seen = new Set();
    const push = (value) => {
      const text = normalize(String(value || '').split(/Listen:/i)[0]);
      if (!isCleanSpeechStatement(text) || seen.has(text)) return;
      seen.add(text);
      statements.push(text);
    };

    const blocks = deepFindAll((el) => el.matches?.('app-snack-element'));
    blocks.forEach((block) => push(block.innerText || block.textContent));

    if (statements.length) return statements;

    const statementNodes = deepFindAll((el) => el.matches?.('.statement, .question-text, .snack-text'));
    statementNodes.forEach((el) => push(el.textContent));
    return statements;
  }

  function captureSpeechStatementsIfPresent() {
    if (!isSpeechLabRecordPage()) return;
    if (state.speechStatements.some(isCleanSpeechStatement)) return;
    const statements = scrapeSpeechStatementsFromDom();
    if (!statements.length) return;
    saveHelpersCache({
      snackId: getSnackPathId(),
      situationScript: state.situationScript,
      speechStatements: statements
    });
  }

  function applySpeechPhrase(item) {
    if (!item?.input || !item.phrase) return;
    setInputValue(item.input, item.phrase);
  }

  function mountSpeechLabPrefill() {
    if (!isSpeechLabDictationPage()) return false;
    if (!state.speechStatements.length) applyHelpersCache(loadHelpersCache());
    if (!state.speechStatements.length) return false;

    const inputs = findInputs();
    if (!inputs.length) return false;

    state.speechPrefillItems = inputs.map((input, idx) => {
      const phrase = state.speechStatements[idx] || '';
      if (phrase) mountControlCompleteButton(input, () => setInputValue(input, phrase));
      return { input, phrase };
    });

    ensureCompleteAllButton(() => {
      state.speechPrefillItems.forEach(applySpeechPhrase);
    });

    state.mode = 'speech-lab';
    window.__wuepExerciseProbe = 'snacks-mounted-speech-lab';
    return true;
  }

  function teardownSpeechLabPrefill() {
    state.speechPrefillItems = [];
  }

  function syncHelpersFromCache() {
    applyHelpersCache(loadHelpersCache());
  }

  function onHelpersMessage(event) {
    if (event.source !== window) return;
    if (event.data?.source !== 'wuep-ecampus-plus') return;
    if (event.data.type !== 'snack-helpers') return;

    const helpers = event.data.helpers;
    if (!helpers) return;
    applyHelpersCache(helpers);
    queueRefresh();
  }

  // ------------------------
  // Lifecycle
  // ------------------------

  function teardownUI() {
    teardownSituationScriptPanel();
    teardownSpeechLabPrefill();
    teardownSituationAutocomplete();
    teardownCompleteUi();
    reorderMode.unmount();
    rewriteMode.unmount();
    wordListMode.unmount();
    state.mode = null;
    state.bootstrapped = false;
    window.__wuepExerciseProbe = 'disabled';
  }

  function init() {
    if (!state.enabled || !isSnacksPath()) {
      teardownUI();
      return;
    }

    teardownUI();
    syncHelpersFromCache();
    captureSituationScriptIfPresent();
    captureSpeechStatementsIfPresent();

    const mountedSpeech = mountSpeechLabPrefill();
    const mountedScript = mountSituationScriptPanel();

    if (mountedSpeech) {
      state.bootstrapped = true;
      return;
    }

    if (!isSituationQuestionPage() && reorderMode.mount()) {
      state.mode = 'reorder';
      window.__wuepExerciseProbe = 'snacks-mounted-reorder';
      state.bootstrapped = true;
      return;
    }

    if (!isSituationQuestionPage() && !isSpeechLabDictationPage() && rewriteMode.mount()) {
      state.mode = 'rewrite';
      window.__wuepExerciseProbe = 'snacks-mounted-rewrite';
      state.bootstrapped = true;
      return;
    }

    if (!isSituationQuestionPage() && wordListMode.mount()) {
      state.mode = 'word-list';
      window.__wuepExerciseProbe = 'snacks-mounted-word-list';
      state.bootstrapped = true;
      return;
    }

    if (mountedScript) {
      state.bootstrapped = true;
      return;
    }

    window.__wuepExerciseProbe = 'snacks-no-known-pattern-yet';
  }

  function refreshIfNeeded() {
    if (!state.enabled) return;

    if (!isSnacksPath()) {
      if (state.bootstrapped || situationPanel.hasUi()) {
        teardownUI();
      }
      return;
    }

    if (!isSituationQuestionPage()) {
      teardownSituationScriptPanel();
      if (state.mode === 'situation-script') {
        state.mode = null;
        state.bootstrapped = false;
      }
    }

    if (isSituationQuestionPage()) {
      syncHelpersFromCache();
      mountSituationScriptPanel();
    }

    if (!state.bootstrapped) {
      init();
      return;
    }

    if (state.mode === 'reorder') {
      if (!reorderMode.hasConnectedItems()) {
        state.bootstrapped = false;
        init();
      }
      return;
    }

    if (state.mode === 'rewrite') {
      if (!rewriteMode.hasConnectedItems()) {
        state.bootstrapped = false;
        init();
      }
      return;
    }

    if (state.mode === 'word-list') {
      if (!wordListMode.hasConnectedItems()) {
        state.bootstrapped = false;
        init();
        return;
      }
      wordListMode.reconcile();
      return;
    }

    if (state.mode === 'speech-lab') {
      if (!state.speechPrefillItems.some((item) => item.input?.isConnected)) {
        state.bootstrapped = false;
        init();
      }
      return;
    }

    if (state.mode === 'situation-script') {
      if (!isSituationQuestionPage()) {
        state.bootstrapped = false;
        init();
        return;
      }
      if (!situationPanel.hasConnectedUi()) {
        state.bootstrapped = false;
        init();
        return;
      }
      if (findSituationFillControls().length && !document.getElementById(COMPLETE_ALL_ID)) {
        mountSituationAutocomplete();
      }
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
    const start = (enabled) => {
      state.enabled = enabled !== false;
      window.addEventListener('message', onHelpersMessage);
      window.addEventListener('popstate', queueRefresh);
      ['pushState', 'replaceState'].forEach((method) => {
        const original = history[method];
        if (typeof original !== 'function' || original.__wuepPatched) return;
        const patched = function patchedHistory(...args) {
          const result = original.apply(this, args);
          queueRefresh();
          return result;
        };
        patched.__wuepPatched = true;
        history[method] = patched;
      });
      syncHelpersFromCache();
      startObserver();
      if (state.enabled) queueRefresh();
      else teardownUI();

      if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
        chrome.storage.onChanged.addListener((changes, area) => {
          if (area !== 'sync') return;
          if (changes[ENABLED_KEY]) setEnabled(Boolean(changes[ENABLED_KEY].newValue));
        });
      }
    };

    if (typeof chrome !== 'undefined' && chrome.storage?.sync?.get) {
      chrome.storage.sync.get([ENABLED_KEY], (res) => {
        start(typeof res?.[ENABLED_KEY] === 'boolean' ? res[ENABLED_KEY] : true);
      });
      return;
    }

    start(true);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
  } else {
    bootstrap();
  }
})();
