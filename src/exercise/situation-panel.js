const SCRIPT_PANEL_ID = 'wuep-script-panel';
const SCRIPT_FAB_ID = 'wuep-script-fab';
const PANEL_HIDDEN_KEY = 'wuep_script_panel_hidden';
const PANEL_COLLAPSED_KEY = 'wuep_script_panel_collapsed';
const PANEL_POS_KEY = 'wuep_script_panel_pos';

export function createSituationPanel({ document, window, getStorage }) {
  let panelEl = null;
  let fabEl = null;
  let scriptLines = [];

  function readPreference(key, fallback) {
    try {
      return getStorage().getItem(key);
    } catch {
      return fallback;
    }
  }

  function writePreference(key, value) {
    try {
      getStorage().setItem(key, value);
    } catch {
      // Storage is optional; the visible UI still responds to the click.
    }
  }

  function isPanelHidden() {
    return readPreference(PANEL_HIDDEN_KEY, null) !== '0';
  }

  function setPanelHidden(hidden) {
    writePreference(PANEL_HIDDEN_KEY, hidden ? '1' : '0');
  }

  function isPanelCollapsed() {
    return readPreference(PANEL_COLLAPSED_KEY, null) === '1';
  }

  function setPanelCollapsed(collapsed) {
    writePreference(PANEL_COLLAPSED_KEY, collapsed ? '1' : '0');
  }

  function loadPanelPosition() {
    try {
      const parsed = JSON.parse(readPreference(PANEL_POS_KEY, null) || 'null');
      if (!parsed || typeof parsed !== 'object') return null;
      const left = Number(parsed.left);
      const top = Number(parsed.top);
      if (!Number.isFinite(left) || !Number.isFinite(top)) return null;
      return { left, top };
    } catch {
      return null;
    }
  }

  function savePanelPosition(panel) {
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    writePreference(PANEL_POS_KEY, JSON.stringify({ left: rect.left, top: rect.top }));
  }

  function clampPanelPosition(panel, left, top) {
    const width = panel.offsetWidth || 320;
    const height = Math.min(panel.offsetHeight || 48, window.innerHeight - 16);
    const maxLeft = Math.max(8, window.innerWidth - width - 8);
    const maxTop = Math.max(8, window.innerHeight - height - 8);
    return {
      left: Math.min(Math.max(8, left), maxLeft),
      top: Math.min(Math.max(8, top), maxTop)
    };
  }

  function applyPanelPosition(panel) {
    if (!panel) return;
    const saved = loadPanelPosition();
    if (!saved) {
      panel.style.top = '88px';
      panel.style.right = '16px';
      panel.style.left = 'auto';
      return;
    }
    const next = clampPanelPosition(panel, saved.left, saved.top);
    panel.style.right = 'auto';
    panel.style.left = `${next.left}px`;
    panel.style.top = `${next.top}px`;
  }

  function installPanelDrag(panel) {
    const header = panel.querySelector('.wuep-script-header');
    if (!header || header.dataset.wuepDragBound === '1') return;
    header.dataset.wuepDragBound = '1';

    let dragging = false;
    let startX = 0;
    let startY = 0;
    let origLeft = 0;
    let origTop = 0;

    header.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      if (event.target.closest('button')) return;
      const rect = panel.getBoundingClientRect();
      dragging = true;
      startX = event.clientX;
      startY = event.clientY;
      origLeft = rect.left;
      origTop = rect.top;
      panel.style.right = 'auto';
      panel.style.left = `${origLeft}px`;
      panel.style.top = `${origTop}px`;
      header.classList.add('wuep-script-dragging');
      header.setPointerCapture(event.pointerId);
      event.preventDefault();
    });

    header.addEventListener('pointermove', (event) => {
      if (!dragging) return;
      const next = clampPanelPosition(panel, origLeft + event.clientX - startX, origTop + event.clientY - startY);
      panel.style.left = `${next.left}px`;
      panel.style.top = `${next.top}px`;
    });

    const stopDrag = (event) => {
      if (!dragging) return;
      dragging = false;
      header.classList.remove('wuep-script-dragging');
      if (header.hasPointerCapture?.(event.pointerId)) header.releasePointerCapture(event.pointerId);
      savePanelPosition(panel);
    };

    header.addEventListener('pointerup', stopDrag);
    header.addEventListener('pointercancel', stopDrag);
  }

  function renderScriptPanel() {
    const panel = panelEl;
    if (!panel) return;

    const collapsed = isPanelCollapsed();
    panel.classList.toggle('wuep-script-panel-collapsed', collapsed);

    const collapseBtn = panel.querySelector('.wuep-script-collapse');
    if (collapseBtn) {
      collapseBtn.textContent = collapsed ? 'Expand' : 'Collapse';
      collapseBtn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    }

    const list = panel.querySelector('.wuep-script-list');
    if (!list) return;
    list.innerHTML = '';

    scriptLines.forEach((entry) => {
      const item = document.createElement('li');
      item.className = 'wuep-script-line';

      if (entry.speaker) {
        const speaker = document.createElement('strong');
        speaker.className = 'wuep-script-speaker';
        speaker.textContent = entry.speaker;
        item.appendChild(speaker);
      }

      const line = document.createElement('span');
      line.className = 'wuep-script-text';
      line.textContent = entry.line;
      item.appendChild(line);
      list.appendChild(item);
    });
  }

  function createScriptFabIcon() {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.classList.add('wuep-script-fab-icon');

    const page = document.createElementNS(ns, 'path');
    page.setAttribute('d', 'M7 3.8h7.2L19 8.6V20.2a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4.8a1 1 0 0 1 1-1z');
    page.setAttribute('fill', 'none');
    page.setAttribute('stroke', 'currentColor');
    page.setAttribute('stroke-width', '1.7');
    page.setAttribute('stroke-linejoin', 'round');

    const fold = document.createElementNS(ns, 'path');
    fold.setAttribute('d', 'M14.2 3.8V8.6H19');
    fold.setAttribute('fill', 'none');
    fold.setAttribute('stroke', 'currentColor');
    fold.setAttribute('stroke-width', '1.7');
    fold.setAttribute('stroke-linejoin', 'round');

    const line1 = document.createElementNS(ns, 'path');
    line1.setAttribute('d', 'M8.6 12.2h6.8M8.6 15.4h4.8');
    line1.setAttribute('fill', 'none');
    line1.setAttribute('stroke', 'currentColor');
    line1.setAttribute('stroke-width', '1.7');
    line1.setAttribute('stroke-linecap', 'round');

    svg.append(page, fold, line1);
    return svg;
  }

  function hideScriptPanel() {
    setPanelHidden(true);
    if (panelEl?.parentNode) panelEl.remove();
    panelEl = null;
    document.body.classList.remove('wuep-has-script-panel');
    ensureScriptFab();
  }

  function showScriptPanel() {
    setPanelHidden(false);
    setPanelCollapsed(false);
    removeScriptFab();
    ensureScriptPanel();
  }

  function ensureScriptFab() {
    if (document.getElementById(SCRIPT_FAB_ID)) {
      fabEl = document.getElementById(SCRIPT_FAB_ID);
      return;
    }

    const fab = document.createElement('button');
    fab.id = SCRIPT_FAB_ID;
    fab.type = 'button';
    fab.className = 'wuep-script-fab';
    fab.title = 'Show dialogue script';
    fab.setAttribute('aria-label', 'Show dialogue script');
    fab.appendChild(createScriptFabIcon());
    fab.addEventListener('click', (event) => {
      event.preventDefault();
      showScriptPanel();
    });
    document.body.appendChild(fab);
    fabEl = fab;
  }

  function removeScriptFab() {
    const fab = fabEl || document.getElementById(SCRIPT_FAB_ID);
    if (fab?.parentNode) fab.remove();
    fabEl = null;
  }

  function createPanelButton(className, text, onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    if (text) button.textContent = text;
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      onClick();
    });
    return button;
  }

  function createScriptPanel() {
    const panel = document.createElement('aside');
    panel.id = SCRIPT_PANEL_ID;
    panel.className = 'wuep-script-panel';
    panel.setAttribute('aria-label', 'Dialogue script');

    const header = document.createElement('div');
    header.className = 'wuep-script-header';

    const title = document.createElement('h2');
    title.className = 'wuep-script-title';
    title.textContent = 'Script';

    const actions = document.createElement('div');
    actions.className = 'wuep-script-actions';
    actions.append(
      createPanelButton('wuep-script-collapse', '', () => {
        setPanelCollapsed(!isPanelCollapsed());
        renderScriptPanel();
      }),
      createPanelButton('wuep-script-toggle', 'Hide', hideScriptPanel)
    );
    header.append(title, actions);

    const list = document.createElement('ul');
    list.className = 'wuep-script-list';
    panel.append(header, list);
    return panel;
  }

  function ensureScriptPanel() {
    const existing = document.getElementById(SCRIPT_PANEL_ID);
    if (existing) {
      panelEl = existing;
      return;
    }

    const panel = createScriptPanel();
    document.body.appendChild(panel);
    installPanelDrag(panel);
    panelEl = panel;
    applyPanelPosition(panel);
    renderScriptPanel();
  }

  function mount(lines) {
    scriptLines = lines;
    if (isPanelHidden()) {
      if (panelEl?.parentNode) panelEl.remove();
      panelEl = null;
      document.body.classList.remove('wuep-has-script-panel');
      ensureScriptFab();
    } else {
      removeScriptFab();
      ensureScriptPanel();
    }
  }

  function unmount() {
    document.body.classList.remove('wuep-has-script-panel');
    if (panelEl?.parentNode) panelEl.remove();
    panelEl = null;
    removeScriptFab();
    document.getElementById(SCRIPT_PANEL_ID)?.remove();
    document.getElementById(SCRIPT_FAB_ID)?.remove();
  }

  function hasConnectedUi() {
    return Boolean(panelEl?.isConnected || fabEl?.isConnected);
  }

  function hasUi() {
    return Boolean(panelEl || fabEl || document.getElementById(SCRIPT_PANEL_ID) || document.getElementById(SCRIPT_FAB_ID));
  }

  return { mount, unmount, hasConnectedUi, hasUi };
}
