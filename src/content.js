(() => {
  if (window.__wuepBootstrapped) return;
  window.__wuepBootstrapped = true;

  const STORAGE_KEY = 'wuep_filters_v4';
  const ENABLED_KEY = 'wuep_enabled';
  const PANEL_ID = 'wuep-panel';
  const TRIGGER_ID = 'wuep-trigger';

  const DEFAULT_STATE = { classType: 'all' };
  const state = { ...DEFAULT_STATE, enabled: true, open: false };

  let observer = null;
  let scheduled = false;

  const isSchedulePage = () => /\/Api\/ScheduleAClass(?:School|Live|Ff|Hf)?$/i.test(location.pathname);

  function normalizeText(value) {
    return (value || '').replace(/\s+/g, ' ').trim();
  }

  function getRows() {
    return Array.from(document.querySelectorAll('app-schedule-row'));
  }

  function isNativeVisible(row) {
    const hadHiddenClass = row.classList.contains('wuep-row-hidden');
    if (hadHiddenClass) row.classList.remove('wuep-row-hidden');

    let visible = true;
    let node = row;
    while (node && node.nodeType === 1) {
      const style = window.getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden') {
        visible = false;
        break;
      }
      node = node.parentElement;
    }

    const rect = row.getBoundingClientRect();
    if (!rect.width || !rect.height) visible = false;

    if (hadHiddenClass) row.classList.add('wuep-row-hidden');
    return visible;
  }

  function extractTitle(row) {
    const titleNode = row.querySelector('app-schedule-info .title');
    if (titleNode) return normalizeText(titleNode.textContent);

    const rowText = normalizeText(row.textContent);
    const dayPattern = /(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/i;
    const parts = rowText.split(dayPattern);
    return normalizeText(parts[0] || rowText);
  }

  function inferClassType(title) {
    return /face to face/i.test(title) ? 'face' : 'havefun';
  }

  function rowMatchesClassType(row) {
    const title = extractTitle(row);
    if (!title) return false;
    const classType = inferClassType(title);
    return state.classType === 'all' || classType === state.classType;
  }

  function updateStatus(nativeRows) {
    const status = document.querySelector('#wuep-status');
    if (!status) return;
    const rows = nativeRows || getRows().filter(isNativeVisible);
    const visible = rows.filter((row) => !row.classList.contains('wuep-row-hidden')).length;
    status.textContent = `${visible} visible / ${rows.length} total`;
  }

  function clearFilteringArtifacts() {
    getRows().forEach((row) => row.classList.remove('wuep-row-hidden'));
  }

  function applyClassTypeFilterNow() {
    if (!state.enabled) {
      clearFilteringArtifacts();
      return;
    }

    const allRows = getRows();
    if (!allRows.length) {
      updateStatus([]);
      return;
    }

    allRows.forEach((row) => row.classList.remove('wuep-row-hidden'));
    const nativeRows = allRows.filter(isNativeVisible);

    nativeRows.forEach((row) => {
      const keep = rowMatchesClassType(row);
      row.classList.toggle('wuep-row-hidden', !keep);
    });

    updateStatus(nativeRows);
  }

  function scheduleApply() {
    if (scheduled) return;
    scheduled = true;

    requestAnimationFrame(() => {
      scheduled = false;
      try {
        applyClassTypeFilterNow();
      } catch (error) {
        console.error('[WUEP] apply failed:', error);
      }
    });
  }

  function saveState() {
    try {
      chrome.storage.sync.set({
        [STORAGE_KEY]: { classType: state.classType },
        [ENABLED_KEY]: state.enabled
      });
    } catch {
      // no-op
    }
  }

  function setState(partial) {
    Object.assign(state, partial);
    saveState();
    syncControls();
    renderEnabledState();
    scheduleApply();
  }

  function syncControls() {
    document.querySelectorAll('#wuep-panel input[type="radio"]').forEach((input) => {
      input.checked = state.classType === input.value;
    });
  }

  function createClassTypeRadio(value, label) {
    const wrapper = document.createElement('label');
    wrapper.className = 'wuep-option';

    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'classType';
    input.value = value;
    input.addEventListener('change', () => setState({ classType: value }));

    const text = document.createElement('span');
    text.textContent = label;

    wrapper.append(input, text);
    return wrapper;
  }

  function buildPanel() {
    if (document.getElementById(PANEL_ID)) return;

    const panel = document.createElement('aside');
    panel.id = PANEL_ID;
    panel.hidden = true;

    panel.innerHTML = `
      <div class="wuep-header">
        <div class="wuep-title">Class Type Filter</div>
        <button id="wuep-close" type="button" aria-label="Close">×</button>
      </div>
      <div class="wuep-body" id="wuep-class-type"></div>
      <div class="wuep-footer" id="wuep-status">Preparing...</div>
    `;

    const body = panel.querySelector('#wuep-class-type');
    body.append(
      createClassTypeRadio('all', 'All'),
      createClassTypeRadio('face', 'Face to Face'),
      createClassTypeRadio('havefun', 'Have Fun')
    );

    panel.querySelector('#wuep-close').addEventListener('click', () => closePanel());

    document.body.appendChild(panel);
    syncControls();
  }

  function ensureTriggerHost() {
    const items = Array.from(document.querySelectorAll('span.submenu-item')).filter((n) => n.offsetParent !== null);
    return items[0]?.parentElement?.parentElement || items[0]?.parentElement || null;
  }

  function buildTrigger() {
    if (document.getElementById(TRIGGER_ID)) return;
    const host = ensureTriggerHost();
    if (!host) return;

    const btn = document.createElement('button');
    btn.id = TRIGGER_ID;
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Open filter panel');
    btn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M3 5h18"></path>
        <path d="M6 12h12"></path>
        <path d="M10 19h4"></path>
      </svg>
    `;

    btn.addEventListener('click', () => {
      if (state.open) closePanel();
      else openPanel();
    });

    host.appendChild(btn);
  }

  function panelAndTrigger() {
    return {
      panel: document.getElementById(PANEL_ID),
      trigger: document.getElementById(TRIGGER_ID)
    };
  }

  function positionPanel() {
    const { panel, trigger } = panelAndTrigger();
    if (!panel || !trigger || panel.hidden) return;

    const rect = trigger.getBoundingClientRect();
    panel.style.top = `${rect.bottom + 8}px`;
    panel.style.left = `${Math.max(8, rect.right - panel.offsetWidth)}px`;
  }

  function openPanel() {
    const { panel, trigger } = panelAndTrigger();
    if (!panel || !trigger) return;
    panel.hidden = false;
    trigger.classList.add('wuep-open');
    state.open = true;
    positionPanel();
  }

  function closePanel() {
    const { panel, trigger } = panelAndTrigger();
    if (!panel || !trigger) return;
    panel.hidden = true;
    trigger.classList.remove('wuep-open');
    state.open = false;
  }

  function hideNativeClassTypeFilters() {
    const native = Array.from(document.querySelectorAll('span.submenu-item')).filter((el) => {
      const t = normalizeText(el.textContent).toLowerCase();
      return t === 'face to face' || t === 'have fun';
    });

    native.forEach((el) => {
      const wrapper = el.parentElement || el;
      wrapper.classList.add('wuep-native-hidden');
    });
  }

  function showNativeClassTypeFilters() {
    document.querySelectorAll('.wuep-native-hidden').forEach((el) => el.classList.remove('wuep-native-hidden'));
  }

  function handleOutsideClick(event) {
    if (!state.open) return;
    const { panel, trigger } = panelAndTrigger();
    if (!panel || !trigger) return;

    const target = event.target;
    if (panel.contains(target) || trigger.contains(target)) return;
    closePanel();
  }

  function renderEnabledState() {
    const { panel, trigger } = panelAndTrigger();

    if (!state.enabled || !isSchedulePage()) {
      closePanel();
      if (panel) panel.hidden = true;
      if (trigger) trigger.style.display = 'none';
      showNativeClassTypeFilters();
      clearFilteringArtifacts();
      return;
    }

    if (panel) panel.hidden = !state.open;
    if (trigger) trigger.style.display = 'inline-flex';
    hideNativeClassTypeFilters();
  }

  function startObserver() {
    if (observer) observer.disconnect();

    const target = document.querySelector('main') || document.body;
    observer = new MutationObserver((mutations) => {
      const shouldReapply = mutations.some((m) => m.type === 'childList');
      if (!shouldReapply) return;

      if (state.enabled && isSchedulePage()) {
        buildTrigger();
        hideNativeClassTypeFilters();
        if (state.open) positionPanel();
      }
      scheduleApply();
    });

    observer.observe(target, { childList: true, subtree: true });
  }

  function attachGlobalListeners() {
    document.addEventListener('click', handleOutsideClick, true);
    window.addEventListener('resize', positionPanel);
    window.addEventListener('scroll', positionPanel, true);

    if (chrome?.storage?.onChanged) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'sync') return;
        if (changes[ENABLED_KEY]) {
          state.enabled = Boolean(changes[ENABLED_KEY].newValue);
          renderEnabledState();
          scheduleApply();
        }
      });
    }
  }

  function initUI() {
    if (!isSchedulePage()) return;
    buildPanel();
    buildTrigger();
    renderEnabledState();
    scheduleApply();
  }

  function loadStateAndInit() {
    try {
      chrome.storage.sync.get([STORAGE_KEY, ENABLED_KEY], (result) => {
        const saved = result?.[STORAGE_KEY];
        if (saved && ['all', 'face', 'havefun'].includes(saved.classType)) {
          state.classType = saved.classType;
        }

        if (typeof result?.[ENABLED_KEY] === 'boolean') {
          state.enabled = result[ENABLED_KEY];
        }

        attachGlobalListeners();
        startObserver();
        initUI();
      });
    } catch {
      attachGlobalListeners();
      startObserver();
      initUI();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadStateAndInit, { once: true });
  } else {
    loadStateAndInit();
  }
})();
