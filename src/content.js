(() => {
  if (window.__wuepInitialized) return;
  window.__wuepInitialized = true;

  const STORAGE_KEY = 'wuep_filters_v1';
  const DELIVERY_CALIBRATION_KEY = 'wuep_delivery_icon_calibration_v1';
  const PANEL_ID = 'wuep-panel';
  const CALIBRATION_TTL_MS = 24 * 60 * 60 * 1000;

  const DEFAULT_STATE = {
    classType: 'all', // all | face | havefun
    delivery: 'all' // all | school | live
  };

  const state = { ...DEFAULT_STATE };
  let observer = null;
  let scheduled = false;

  const deliveryIconMap = {
    school: new Set(),
    live: new Set(),
    calibratedAt: 0
  };

  function getRows() {
    return Array.from(document.querySelectorAll('app-schedule-row'));
  }

  function getVisibleRows() {
    return getRows().filter((row) => row.offsetParent !== null || row.classList.contains('wuep-row-hidden'));
  }

  function normalizeText(value) {
    return (value || '').replace(/\s+/g, ' ').trim();
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

  function extractIconKeyFromRow(row) {
    const image = row.querySelector('app-image.icon.image img, app-image.image.icon img, app-image img');
    if (!image) return '';

    const src = image.getAttribute('src') || image.src || '';
    if (!src) return '';

    try {
      const url = new URL(src, location.origin);
      const match = url.pathname.match(/\/CLASS-ICON\/([^/.]+)/i);
      if (match?.[1]) return match[1].toLowerCase();
      return url.pathname.toLowerCase();
    } catch {
      return src.toLowerCase();
    }
  }

  function inferDeliveryMode(row) {
    const iconKey = extractIconKeyFromRow(row);

    if (iconKey) {
      if (deliveryIconMap.live.has(iconKey)) return 'live';
      if (deliveryIconMap.school.has(iconKey)) return 'school';
    }

    return 'unknown';
  }

  function rowMatches(row) {
    const title = extractTitle(row);
    if (!title) return false;

    const classType = inferClassType(title);
    const delivery = inferDeliveryMode(row);

    const classTypeMatch = state.classType === 'all' || classType === state.classType;

    let deliveryMatch = true;
    if (state.delivery !== 'all') {
      deliveryMatch = delivery === state.delivery;
    }

    return classTypeMatch && deliveryMatch;
  }

  function updateStatus(extra = '') {
    const status = document.querySelector('#wuep-status');
    if (!status) return;

    const rows = getRows();
    const visible = rows.filter((row) => !row.classList.contains('wuep-row-hidden')).length;
    const calibrated = Date.now() - deliveryIconMap.calibratedAt < CALIBRATION_TTL_MS;
    const calibrationLabel = calibrated ? 'calibrated' : 'not calibrated';

    status.textContent = `${visible} visible / ${rows.length} total · ${calibrationLabel}${extra ? ` · ${extra}` : ''}`;
  }

  function applyFiltersNow() {
    const rows = getRows();
    if (!rows.length) {
      updateStatus('waiting rows');
      return;
    }

    for (const row of rows) {
      const keep = rowMatches(row);
      row.classList.toggle('wuep-row-hidden', !keep);
    }

    updateStatus();
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
        updateStatus('apply error');
      }
    });
  }

  function saveState() {
    try {
      chrome.storage.sync.set({ [STORAGE_KEY]: state });
    } catch {
      // no-op in restricted contexts
    }
  }

  function saveCalibration() {
    try {
      chrome.storage.sync.set({
        [DELIVERY_CALIBRATION_KEY]: {
          school: Array.from(deliveryIconMap.school),
          live: Array.from(deliveryIconMap.live),
          calibratedAt: deliveryIconMap.calibratedAt
        }
      });
    } catch {
      // no-op
    }
  }

  function setState(partial) {
    Object.assign(state, partial);
    saveState();
    syncControls();
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

  function getFilterSpanByText(text) {
    return Array.from(document.querySelectorAll('span.submenu-item')).find(
      (el) => normalizeText(el.textContent) === text && el.offsetParent !== null
    );
  }

  function waitForUrlContains(token, timeoutMs = 10000) {
    return new Promise((resolve) => {
      const start = Date.now();
      const check = () => {
        if (location.href.includes(token)) return resolve(true);
        if (Date.now() - start > timeoutMs) return resolve(false);
        setTimeout(check, 120);
      };
      check();
    });
  }

  async function clickNativeFilterAndWait(filterName, expectedUrlPart) {
    const button = getFilterSpanByText(filterName);
    if (!button) return false;

    button.click();
    const ok = await waitForUrlContains(expectedUrlPart);

    await new Promise((resolve) => setTimeout(resolve, 500));
    return ok;
  }

  function collectVisibleIconKeys() {
    const rows = getRows().filter((row) => row.offsetParent !== null);
    return new Set(rows.map(extractIconKeyFromRow).filter(Boolean));
  }

  async function calibrateDeliveryIcons() {
    const calibrateBtn = document.querySelector('#wuep-calibrate');
    if (calibrateBtn) {
      calibrateBtn.disabled = true;
      calibrateBtn.textContent = 'Calibrating...';
    }

    const originalUrl = location.href;
    const originalRowsHiddenState = getRows().map((row) => row.classList.contains('wuep-row-hidden'));

    try {
      updateStatus('calibrating');

      const schoolReady = await clickNativeFilterAndWait('School', 'ScheduleAClassSchool');
      const schoolSet = schoolReady ? collectVisibleIconKeys() : new Set();

      const liveReady = await clickNativeFilterAndWait('Live', 'ScheduleAClassLive');
      const liveSet = liveReady ? collectVisibleIconKeys() : new Set();

      deliveryIconMap.school = schoolSet;
      deliveryIconMap.live = liveSet;
      deliveryIconMap.calibratedAt = Date.now();
      saveCalibration();

      if (originalUrl !== location.href) {
        location.href = originalUrl;
        await new Promise((resolve) => setTimeout(resolve, 900));
      }

      const rows = getRows();
      rows.forEach((row, idx) => {
        const wasHidden = originalRowsHiddenState[idx];
        if (wasHidden) row.classList.add('wuep-row-hidden');
        else row.classList.remove('wuep-row-hidden');
      });

      scheduleApply();
      updateStatus(`icons S:${schoolSet.size} L:${liveSet.size}`);
    } catch (error) {
      console.error('[WUEP] calibration failed:', error);
      updateStatus('calibration error');
    } finally {
      if (calibrateBtn) {
        calibrateBtn.disabled = false;
        calibrateBtn.textContent = 'Calibrate';
      }
    }
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
          <button class="wuep-btn" id="wuep-calibrate" type="button">Calibrate</button>
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

    panel.querySelector('#wuep-calibrate').addEventListener('click', () => {
      calibrateDeliveryIcons();
    });

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
    return (
      document.querySelector('app-home-box') ||
      document.querySelector('main') ||
      document.body
    );
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

  function isCalibrationFresh(timestamp) {
    return Number.isFinite(timestamp) && Date.now() - timestamp < CALIBRATION_TTL_MS;
  }

  function loadStateAndInit() {
    try {
      chrome.storage.sync.get([STORAGE_KEY, DELIVERY_CALIBRATION_KEY], (result) => {
        const saved = result?.[STORAGE_KEY];
        if (saved && typeof saved === 'object') {
          if (['all', 'face', 'havefun'].includes(saved.classType)) state.classType = saved.classType;
          if (['all', 'school', 'live'].includes(saved.delivery)) state.delivery = saved.delivery;
        }

        const calibration = result?.[DELIVERY_CALIBRATION_KEY];
        if (calibration && typeof calibration === 'object') {
          deliveryIconMap.school = new Set(Array.isArray(calibration.school) ? calibration.school : []);
          deliveryIconMap.live = new Set(Array.isArray(calibration.live) ? calibration.live : []);
          deliveryIconMap.calibratedAt = Number(calibration.calibratedAt || 0);
        }

        ensureReadyAndInit();

        if (!isCalibrationFresh(deliveryIconMap.calibratedAt)) {
          setTimeout(() => {
            calibrateDeliveryIcons();
          }, 800);
        }
      });
    } catch {
      ensureReadyAndInit();
      setTimeout(() => {
        calibrateDeliveryIcons();
      }, 1000);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadStateAndInit, { once: true });
  } else {
    loadStateAndInit();
  }
})();
