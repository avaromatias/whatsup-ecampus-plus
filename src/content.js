(() => {
  if (window.__wuepBootstrapped) return;
  window.__wuepBootstrapped = true;

  const STORAGE_KEY = 'wuep_filters_v6';
  const ENABLED_KEY = 'wuep_enabled';
  const PANEL_ID = 'wuep-panel';
  const TRIGGER_ID = 'wuep-trigger';

  const DAY_ORDER = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  const DAY_TO_FULL = {
    MON: 'monday',
    TUE: 'tuesday',
    WED: 'wednesday',
    THU: 'thursday',
    FRI: 'friday',
    SAT: 'saturday'
  };

  const MIN_MINUTES = 9 * 60 + 30; // 09:30
  const MAX_MINUTES = 21 * 60 + 30; // 21:30

  const DEFAULT_STATE = {
    classType: 'all',
    selectedDays: [...DAY_ORDER],
    timeStart: MIN_MINUTES,
    timeEnd: MAX_MINUTES
  };

  const state = { ...DEFAULT_STATE, enabled: true, open: false };

  let observer = null;
  let scheduled = false;
  let lastPath = location.pathname;
  let lastStatusText = '';
  let lastRangeText = '';
  let lastAppliedSignature = '';

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

  function extractDay(row) {
    const dayNode = row.querySelector('app-schedule-info .week-day');
    const dayText = normalizeText(dayNode?.textContent || '');
    return dayText.toLowerCase();
  }

  function extractTimeInMinutes(row) {
    const hourNode = row.querySelector('app-schedule-info .hour');
    const text = normalizeText(hourNode?.textContent || '');
    const match = text.match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return null;

    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    return hours * 60 + minutes;
  }

  function inferClassType(title) {
    return /face to face/i.test(title) ? 'face' : 'havefun';
  }

  function dayIsSelected(dayFull) {
    if (!dayFull) return false;
    return state.selectedDays.some((abbr) => DAY_TO_FULL[abbr] === dayFull);
  }

  function rowMatchesFilters(row) {
    const title = extractTitle(row);
    if (!title) return false;

    const classType = inferClassType(title);
    if (state.classType !== 'all' && classType !== state.classType) return false;

    const day = extractDay(row);
    if (!dayIsSelected(day)) return false;

    const minutes = extractTimeInMinutes(row);
    if (minutes == null) return false;
    if (minutes < state.timeStart || minutes > state.timeEnd) return false;

    return true;
  }

  function clearFilteringArtifacts() {
    getRows().forEach((row) => row.classList.remove('wuep-row-hidden'));
  }

  function formatTime(minutes) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  function updateStatus(nativeRows) {
    const status = document.querySelector('#wuep-status');
    const rangeLabel = document.querySelector('#wuep-range-label');

    const rows = nativeRows || getRows().filter(isNativeVisible);
    const visible = rows.filter((row) => !row.classList.contains('wuep-row-hidden')).length;

    const statusText = `${visible} visible / ${rows.length} total`;
    if (status && statusText !== lastStatusText) {
      status.textContent = statusText;
      lastStatusText = statusText;
    }

    const rangeText = `${formatTime(state.timeStart)} → ${formatTime(state.timeEnd)}`;
    if (rangeLabel && rangeText !== lastRangeText) {
      rangeLabel.textContent = rangeText;
      lastRangeText = rangeText;
    }
  }

  function applyFiltersNow() {
    if (!state.enabled || !isSchedulePage()) {
      clearFilteringArtifacts();
      return;
    }

    const allRows = getRows();
    if (!allRows.length) {
      updateStatus([]);
      return;
    }

    const signature = [
      state.classType,
      state.selectedDays.join(','),
      state.timeStart,
      state.timeEnd,
      location.pathname,
      allRows.length
    ].join('|');

    if (signature === lastAppliedSignature) {
      updateStatus();
      return;
    }

    allRows.forEach((row) => row.classList.remove('wuep-row-hidden'));
    const nativeRows = allRows.filter(isNativeVisible);

    nativeRows.forEach((row) => {
      const keep = rowMatchesFilters(row);
      row.classList.toggle('wuep-row-hidden', !keep);
    });

    updateStatus(nativeRows);
    lastAppliedSignature = signature;
  }

  function scheduleApply() {
    if (scheduled) return;
    scheduled = true;

    requestAnimationFrame(() => {
      scheduled = false;
      try {
        applyFiltersNow();
      } catch (error) {
        console.error('[WUEP] apply failed:', error);
      }
    });
  }

  function saveState() {
    try {
      chrome.storage.sync.set({
        [STORAGE_KEY]: {
          classType: state.classType,
          selectedDays: state.selectedDays,
          timeStart: state.timeStart,
          timeEnd: state.timeEnd
        },
        [ENABLED_KEY]: state.enabled
      });
    } catch {
      // no-op
    }
  }

  function setState(partial) {
    Object.assign(state, partial);

    if (state.timeStart > state.timeEnd) {
      const tmp = state.timeStart;
      state.timeStart = state.timeEnd;
      state.timeEnd = tmp;
    }

    lastAppliedSignature = '';
    saveState();
    syncControls();
    renderEnabledState();
    scheduleApply();
  }

  function isDaysDefault() {
    return state.selectedDays.length === DAY_ORDER.length && DAY_ORDER.every((d) => state.selectedDays.includes(d));
  }

  function isTimeDefault() {
    return state.timeStart === MIN_MINUTES && state.timeEnd === MAX_MINUTES;
  }

  function syncControls() {
    document.querySelectorAll('#wuep-panel input[name="classType"]').forEach((input) => {
      input.checked = state.classType === input.value;
    });

    document.querySelectorAll('#wuep-panel .wuep-day').forEach((label) => {
      const value = label.getAttribute('data-day');
      label.classList.toggle('wuep-day-active', state.selectedDays.includes(value));
      const input = label.querySelector('input');
      if (input) input.checked = state.selectedDays.includes(value);
    });

    const startInput = document.querySelector('#wuep-time-start');
    const endInput = document.querySelector('#wuep-time-end');
    if (startInput) startInput.value = String(state.timeStart);
    if (endInput) endInput.value = String(state.timeEnd);

    const resetDays = document.querySelector('#wuep-reset-days');
    const resetTime = document.querySelector('#wuep-reset-time');
    if (resetDays) resetDays.hidden = isDaysDefault();
    if (resetTime) resetTime.hidden = isTimeDefault();

    const rangeLabel = document.querySelector('#wuep-range-label');
    const rangeText = `${formatTime(state.timeStart)} → ${formatTime(state.timeEnd)}`;
    if (rangeLabel && rangeText !== lastRangeText) {
      rangeLabel.textContent = rangeText;
      lastRangeText = rangeText;
    }
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

  function createDayToggle(day) {
    const label = document.createElement('label');
    label.className = 'wuep-day';
    label.setAttribute('data-day', day);

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = true;

    input.addEventListener('change', () => {
      const next = new Set(state.selectedDays);
      if (input.checked) next.add(day);
      else next.delete(day);

      if (!next.size) {
        input.checked = true;
        return;
      }

      setState({ selectedDays: DAY_ORDER.filter((d) => next.has(d)) });
    });

    const span = document.createElement('span');
    span.textContent = day;

    label.append(input, span);
    return label;
  }

  function buildPanel() {
    if (document.getElementById(PANEL_ID)) return;

    const panel = document.createElement('aside');
    panel.id = PANEL_ID;
    panel.hidden = true;

    panel.innerHTML = `
      <div class="wuep-header">
        <div class="wuep-title">Filters</div>
        <button id="wuep-close" type="button" aria-label="Close">×</button>
      </div>
      <div class="wuep-body">
        <section>
          <div class="wuep-section-head">
            <div class="wuep-section-label">Class Type</div>
          </div>
          <div id="wuep-class-type"></div>
        </section>
        <section>
          <div class="wuep-section-head">
            <div class="wuep-section-label">Days</div>
            <button id="wuep-reset-days" class="wuep-reset-mini" type="button" hidden>RESET</button>
          </div>
          <div id="wuep-days" class="wuep-days"></div>
        </section>
        <section>
          <div class="wuep-section-head">
            <div class="wuep-section-label">Time Range</div>
            <button id="wuep-reset-time" class="wuep-reset-mini" type="button" hidden>RESET</button>
          </div>
          <div class="wuep-range-wrap">
            <div class="wuep-range-track" aria-hidden="true"></div>
            <input id="wuep-time-start" type="range" min="${MIN_MINUTES}" max="${MAX_MINUTES}" step="30" />
            <input id="wuep-time-end" type="range" min="${MIN_MINUTES}" max="${MAX_MINUTES}" step="30" />
          </div>
          <div id="wuep-range-label" class="wuep-range-label"></div>
        </section>
      </div>
      <div class="wuep-footer" id="wuep-status">Preparing...</div>
    `;

    const classType = panel.querySelector('#wuep-class-type');
    classType.append(
      createClassTypeRadio('all', 'All'),
      createClassTypeRadio('face', 'Face to Face'),
      createClassTypeRadio('havefun', 'Have Fun')
    );

    const days = panel.querySelector('#wuep-days');
    DAY_ORDER.forEach((d) => days.append(createDayToggle(d)));

    panel.querySelector('#wuep-close').addEventListener('click', () => closePanel());

    panel.querySelector('#wuep-reset-days').addEventListener('click', () => {
      setState({ selectedDays: [...DAY_ORDER] });
    });

    panel.querySelector('#wuep-reset-time').addEventListener('click', () => {
      setState({ timeStart: MIN_MINUTES, timeEnd: MAX_MINUTES });
    });

    const startInput = panel.querySelector('#wuep-time-start');
    const endInput = panel.querySelector('#wuep-time-end');

    startInput.addEventListener('input', () => {
      const value = Number(startInput.value);
      if (value > state.timeEnd) {
        endInput.value = String(value);
        setState({ timeStart: value, timeEnd: value });
      } else {
        setState({ timeStart: value });
      }
    });

    endInput.addEventListener('input', () => {
      const value = Number(endInput.value);
      if (value < state.timeStart) {
        startInput.value = String(value);
        setState({ timeStart: value, timeEnd: value });
      } else {
        setState({ timeEnd: value });
      }
    });

    document.body.appendChild(panel);
    syncControls();
  }

  function findFilterBarRoot() {
    const sample = Array.from(document.querySelectorAll('span.submenu-item')).find((el) => {
      const t = normalizeText(el.textContent);
      return ['Face to Face', 'Have Fun', 'School', 'Live'].includes(t) && el.offsetParent !== null;
    });

    if (!sample) return null;
    return sample.closest('app-sub-menu-buttons') || sample.parentElement?.parentElement || null;
  }

  function ensureToolbarLayout() {
    const root = findFilterBarRoot();
    if (!root) return null;
    root.classList.add('wuep-toolbar-root');
    return root;
  }

  function buildTrigger() {
    const root = ensureToolbarLayout();
    if (!root) return;

    let anchor = root.querySelector('.wuep-anchor');
    if (!anchor) {
      anchor = document.createElement('div');
      anchor.className = 'wuep-anchor';
      root.appendChild(anchor);
    }

    let trigger = document.getElementById(TRIGGER_ID);
    if (!trigger) {
      trigger = document.createElement('button');
      trigger.id = TRIGGER_ID;
      trigger.type = 'button';
      trigger.setAttribute('aria-label', 'Open filter panel');
      trigger.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M3 5h18"></path>
          <path d="M6 12h12"></path>
          <path d="M10 19h4"></path>
        </svg>
      `;
      trigger.addEventListener('click', () => (state.open ? closePanel() : openPanel()));
    }

    if (trigger.parentElement !== anchor) anchor.appendChild(trigger);

    return trigger;
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

    const viewportPadding = 8;
    const rect = trigger.getBoundingClientRect();

    // If trigger is out of viewport, close panel so it does not stay floating.
    const triggerOffscreen = rect.bottom < 0 || rect.top > window.innerHeight || rect.right < 0 || rect.left > window.innerWidth;
    if (triggerOffscreen) {
      closePanel();
      return;
    }

    const maxWidth = Math.max(220, window.innerWidth - viewportPadding * 2);
    panel.style.width = `${Math.min(260, maxWidth)}px`;

    const panelRect = panel.getBoundingClientRect();
    let left = rect.right - panelRect.width;
    const minLeft = viewportPadding;
    const maxLeft = window.innerWidth - panelRect.width - viewportPadding;
    left = Math.min(Math.max(left, minLeft), Math.max(minLeft, maxLeft));

    const top = rect.bottom + 8;
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
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
      const wrapper = el.closest('a') || el;
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

    if (trigger) trigger.style.display = 'inline-flex';
    if (panel) panel.hidden = !state.open;
    hideNativeClassTypeFilters();
  }

  function mountScheduleUI() {
    if (!isSchedulePage()) return;
    buildPanel();
    buildTrigger();
    renderEnabledState();
    if (state.open) positionPanel();
    scheduleApply();
  }

  function startObserver() {
    if (observer) observer.disconnect();

    let mountQueued = false;
    observer = new MutationObserver((mutations) => {
      const shouldReact = mutations.some((m) => {
        if (m.type !== 'childList') return false;
        const target = m.target;
        if (!(target instanceof Element)) return false;
        if (target.closest(`#${PANEL_ID}`) || target.closest('.wuep-anchor')) return false;
        return true;
      });

      if (!shouldReact || mountQueued) return;
      mountQueued = true;
      requestAnimationFrame(() => {
        mountQueued = false;
        mountScheduleUI();
      });
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  function startPathWatcher() {
    setInterval(() => {
      if (location.pathname !== lastPath) {
        lastPath = location.pathname;
        mountScheduleUI();
      }
    }, 300);
  }

  function attachGlobalListeners() {
    document.addEventListener('click', handleOutsideClick, true);
    window.addEventListener('resize', () => {
      if (state.open) positionPanel();
    });
    window.addEventListener('scroll', () => {
      if (state.open) positionPanel();
    }, true);

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

  function loadStateAndInit() {
    try {
      chrome.storage.sync.get([STORAGE_KEY, ENABLED_KEY], (result) => {
        const saved = result?.[STORAGE_KEY];
        if (saved) {
          if (['all', 'face', 'havefun'].includes(saved.classType)) state.classType = saved.classType;
          if (Array.isArray(saved.selectedDays) && saved.selectedDays.length) {
            state.selectedDays = saved.selectedDays.filter((d) => DAY_ORDER.includes(d));
          }
          if (Number.isFinite(saved.timeStart)) state.timeStart = Math.max(MIN_MINUTES, Math.min(MAX_MINUTES, saved.timeStart));
          if (Number.isFinite(saved.timeEnd)) state.timeEnd = Math.max(MIN_MINUTES, Math.min(MAX_MINUTES, saved.timeEnd));
        }

        if (!state.selectedDays.length) state.selectedDays = [...DAY_ORDER];
        if (state.timeStart > state.timeEnd) {
          state.timeStart = MIN_MINUTES;
          state.timeEnd = MAX_MINUTES;
        }

        if (typeof result?.[ENABLED_KEY] === 'boolean') state.enabled = result[ENABLED_KEY];

        buildPanel();
        attachGlobalListeners();
        startObserver();
        startPathWatcher();
        mountScheduleUI();
      });
    } catch {
      buildPanel();
      attachGlobalListeners();
      startObserver();
      startPathWatcher();
      mountScheduleUI();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadStateAndInit, { once: true });
  } else {
    loadStateAndInit();
  }
})();
