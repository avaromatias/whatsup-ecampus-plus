(() => {
  const STORAGE_KEY = 'wuep_filters_v1';
  const PANEL_ID = 'wuep-panel';

  const DEFAULT_STATE = {
    classType: 'all', // all | face | havefun
    delivery: 'all' // all | school | live
  };

  const state = { ...DEFAULT_STATE };

  function getRows() {
    return Array.from(document.querySelectorAll('app-schedule-row'));
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

  function inferDeliveryMode(title) {
    return /\(L\d{2}-\d{2}\)/i.test(title) ? 'live' : 'school';
  }

  function rowMatches(row) {
    const title = extractTitle(row);
    if (!title) return false;

    const classType = inferClassType(title);
    const delivery = inferDeliveryMode(title);

    const classTypeMatch = state.classType === 'all' || classType === state.classType;
    const deliveryMatch = state.delivery === 'all' || delivery === state.delivery;

    return classTypeMatch && deliveryMatch;
  }

  function applyFilters() {
    const rows = getRows();
    let visible = 0;

    rows.forEach((row) => {
      const keep = rowMatches(row);
      row.classList.toggle('wuep-row-hidden', !keep);
      if (keep) visible += 1;
    });

    const status = document.querySelector('#wuep-status');
    if (status) {
      status.textContent = `${visible} visible / ${rows.length} total`;
    }
  }

  function saveState() {
    try {
      chrome.storage.sync.set({ [STORAGE_KEY]: state });
    } catch (_) {
      // no-op
    }
  }

  function setState(partial) {
    Object.assign(state, partial);
    saveState();
    syncControls();
    applyFilters();
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
      applyFilters();
    });

    document.body.appendChild(panel);
    syncControls();
    applyFilters();
  }

  function observeChanges() {
    const root = document.querySelector('main') || document.body;
    const observer = new MutationObserver(() => {
      if (!document.getElementById(PANEL_ID)) return;
      applyFilters();
    });

    observer.observe(root, {
      childList: true,
      subtree: true
    });
  }

  function loadStateAndInit() {
    try {
      chrome.storage.sync.get([STORAGE_KEY], (result) => {
        const saved = result?.[STORAGE_KEY];
        if (saved && typeof saved === 'object') {
          if (['all', 'face', 'havefun'].includes(saved.classType)) state.classType = saved.classType;
          if (['all', 'school', 'live'].includes(saved.delivery)) state.delivery = saved.delivery;
        }
        buildPanel();
        observeChanges();
      });
    } catch (_) {
      buildPanel();
      observeChanges();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadStateAndInit, { once: true });
  } else {
    loadStateAndInit();
  }
})();
