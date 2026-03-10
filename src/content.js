(() => {
  if (window.__wuepInitialized) return;
  window.__wuepInitialized = true;

  const STORAGE_KEY = 'wuep_filters_v2';
  const PANEL_ID = 'wuep-panel';

  const DEFAULT_STATE = {
    classType: 'all', // all | face | havefun
    delivery: 'all' // all | school | live
  };

  const state = { ...DEFAULT_STATE };
  let observer = null;
  let scheduled = false;

  function normalizeText(value) {
    return (value || '').replace(/\s+/g, ' ').trim();
  }

  function getVisibleRows() {
    return Array.from(document.querySelectorAll('app-schedule-row')).filter((row) => row.offsetParent !== null);
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

  function updateStatus() {
    const status = document.querySelector('#wuep-status');
    if (!status) return;

    const rows = getVisibleRows();
    const visible = rows.filter((row) => !row.classList.contains('wuep-row-hidden')).length;
    status.textContent = `${visible} visible / ${rows.length} total`;
  }

  function applyClassTypeFilterNow() {
    const rows = getVisibleRows();
    if (!rows.length) {
      updateStatus();
      return;
    }

    rows.forEach((row) => {
      const keep = rowMatchesClassType(row);
      row.classList.toggle('wuep-row-hidden', !keep);
    });

    updateStatus();
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
      chrome.storage.sync.set({ [STORAGE_KEY]: state });
    } catch {
      // no-op
    }
  }

  function targetUrlForDelivery(delivery) {
    const base = '/Api/ScheduleAClass';
    if (delivery === 'school') return `${location.origin}${base}School`;
    if (delivery === 'live') return `${location.origin}${base}Live`;
    return `${location.origin}${base}`;
  }

  function currentDeliveryFromUrl() {
    const path = location.pathname;
    if (path.endsWith('ScheduleAClassSchool')) return 'school';
    if (path.endsWith('ScheduleAClassLive')) return 'live';
    return 'all';
  }

  function maybeNavigateToDelivery() {
    const expected = targetUrlForDelivery(state.delivery);
    const current = `${location.origin}${location.pathname}`;

    if (current !== expected) {
      location.href = expected;
      return true;
    }

    return false;
  }

  function setState(partial) {
    Object.assign(state, partial);
    saveState();
    syncControls();

    if (partial.delivery) {
      const navigating = maybeNavigateToDelivery();
      if (navigating) return;
    }

    scheduleApply();
  }

  function syncControls() {
    const map = {
      classType: state.classType,
      delivery: state.delivery
    };

    document.querySelectorAll('#wuep-panel input[type="radio"]').forEach((input) => {
      const group = input.getAttribute('name');
      const value = input.getAttribute('value');
      input.checked = map[group] === value;
    });
  }

  function createRadio({ name, value, label }) {
    const wrapper = document.createElement('label');
    wrapper.className = 'wuep-option';

    const input = document.createElement('input');
    input.type = 'radio';
    input.name = name;
    input.value = value;
    input.addEventListener('change', () => {
      if (name === 'classType') setState({ classType: value });
      if (name === 'delivery') setState({ delivery: value });
    });

    const text = document.createElement('span');
    text.textContent = label;

    wrapper.append(input, text);
    return wrapper;
  }

  function buildPanel() {
    if (document.getElementById(PANEL_ID)) return;

    const panel = document.createElement('aside');
    panel.id = PANEL_ID;

    panel.innerHTML = `
      <div class="wuep-header">
        <div class="wuep-title">eCampus Plus Filters</div>
        <div class="wuep-chip">MVP</div>
      </div>
      <div class="wuep-body">
        <section class="wuep-section" id="wuep-class-type">
          <div class="wuep-section-title">Class Type</div>
        </section>
        <div class="wuep-divider"></div>
        <section class="wuep-section" id="wuep-delivery">
          <div class="wuep-section-title">Delivery</div>
        </section>
      </div>
      <div class="wuep-footer">
        <div class="wuep-status" id="wuep-status">Preparing...</div>
        <div class="wuep-actions">
          <button class="wuep-btn" id="wuep-reset" type="button">Reset</button>
          <button class="wuep-btn" id="wuep-refresh" type="button">Refresh</button>
        </div>
      </div>
    `;

    const classSection = panel.querySelector('#wuep-class-type');
    classSection.append(
      createRadio({ name: 'classType', value: 'all', label: 'All' }),
      createRadio({ name: 'classType', value: 'face', label: 'Face to Face' }),
      createRadio({ name: 'classType', value: 'havefun', label: 'Have Fun' })
    );

    const deliverySection = panel.querySelector('#wuep-delivery');
    deliverySection.append(
      createRadio({ name: 'delivery', value: 'all', label: 'All' }),
      createRadio({ name: 'delivery', value: 'school', label: 'School (on-site)' }),
      createRadio({ name: 'delivery', value: 'live', label: 'Live (online)' })
    );

    panel.querySelector('#wuep-reset').addEventListener('click', () => {
      setState({ ...DEFAULT_STATE });
    });

    panel.querySelector('#wuep-refresh').addEventListener('click', () => {
      scheduleApply();
    });

    document.body.appendChild(panel);
    syncControls();
    scheduleApply();
  }

  function resolveObserveTarget() {
    return document.querySelector('app-home-box') || document.querySelector('main') || document.body;
  }

  function startObserver() {
    if (observer) observer.disconnect();

    const target = resolveObserveTarget();
    observer = new MutationObserver((mutations) => {
      const shouldReapply = mutations.some((m) => m.type === 'childList');
      if (shouldReapply) scheduleApply();
    });

    observer.observe(target, {
      childList: true,
      subtree: true
    });
  }

  function ensureReadyAndInit(attempt = 0) {
    const rows = getVisibleRows();
    const maxAttempts = 40;

    if (!rows.length && attempt < maxAttempts) {
      setTimeout(() => ensureReadyAndInit(attempt + 1), 250);
      return;
    }

    buildPanel();
    startObserver();
    scheduleApply();
  }

  function loadStateAndInit() {
    try {
      chrome.storage.sync.get([STORAGE_KEY], (result) => {
        const saved = result?.[STORAGE_KEY];
        if (saved && typeof saved === 'object') {
          if (['all', 'face', 'havefun'].includes(saved.classType)) state.classType = saved.classType;
          if (['all', 'school', 'live'].includes(saved.delivery)) state.delivery = saved.delivery;
        }

        // Keep delivery state in sync with current URL whenever we land on the page.
        state.delivery = currentDeliveryFromUrl();

        ensureReadyAndInit();
      });
    } catch {
      state.delivery = currentDeliveryFromUrl();
      ensureReadyAndInit();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadStateAndInit, { once: true });
  } else {
    loadStateAndInit();
  }
})();
