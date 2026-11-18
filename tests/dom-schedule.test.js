const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { JSDOM } = require('jsdom');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'content.js'), 'utf8');

const markup = `
  <app-sub-menu-buttons>
    <a><span class="submenu-item">Face to Face</span></a>
    <a><span class="submenu-item">Have Fun</span></a>
    <a><span class="submenu-item">School</span></a>
  </app-sub-menu-buttons>
  <app-schedule-row id="monday-face"><app-schedule-info>
    <span class="title">Face to Face A</span><span class="week-day">Monday</span>
    <span class="hour">09:30</span></app-schedule-info></app-schedule-row>
  <app-schedule-row id="tuesday-fun"><app-schedule-info>
    <span class="title">Have Fun B</span><span class="week-day">Tuesday</span>
    <span class="hour">10:00</span></app-schedule-info></app-schedule-row>
  <app-schedule-row id="tuesday-face"><app-schedule-info>
    <span class="title">Face to Face C</span><span class="week-day">Tuesday</span>
    <span class="hour">10:00</span></app-schedule-info></app-schedule-row>
  <section style="display: none"><app-schedule-row id="native-hidden"><app-schedule-info>
    <span class="title">Have Fun D</span><span class="week-day">Monday</span>
    <span class="hour">09:30</span></app-schedule-info></app-schedule-row></section>`;

function loadSchedule() {
  const dom = new JSDOM(markup, {
    url: 'https://ecampus.whatsup.es/Api/ScheduleAClass',
    runScripts: 'outside-only'
  });
  const { window } = dom;
  const { document } = window;
  const frames = [];
  const saved = [];
  let onStorageChanged;

  // JSDOM has no layout. Give only the fixture's native toolbar and rows
  // nonzero geometry; filtering, style visibility, and events remain real.
  const sample = document.querySelector('.submenu-item');
  Object.defineProperty(sample, 'offsetParent', { get: () => sample.parentElement });
  document.querySelectorAll('app-schedule-row').forEach((row) => {
    row.getBoundingClientRect = () => ({ width: 400, height: 36 });
  });
  window.requestAnimationFrame = (callback) => frames.push(callback);
  window.setInterval = () => 1;
  window.chrome = {
    storage: {
      sync: {
        get: (_keys, callback) => callback({ wuep_enabled: true }),
        set: (value) => saved.push(value)
      },
      onChanged: { addListener: (listener) => { onStorageChanged = listener; } }
    }
  };

  window.eval(source);
  document.dispatchEvent(new window.Event('DOMContentLoaded'));

  return {
    window, document, saved,
    flush() {
      let count = 0;
      while (frames.length) {
        assert.ok(++count < 20, 'schedule refresh settled');
        frames.shift()();
      }
    },
    enabled(value) {
      onStorageChanged({ wuep_enabled: { newValue: value } }, 'sync');
      this.flush();
    },
    row(id) { return document.getElementById(id); },
    close() { window.close(); }
  };
}

test('schedule trigger, type/day/range controls filter only natively visible rows', () => {
  const app = loadSchedule();
  try {
    app.flush();
    const panel = app.document.querySelector('#wuep-panel');
    const trigger = app.document.querySelector('#wuep-trigger');
    assert.ok(panel);
    assert.ok(trigger);
    assert.equal(panel.hidden, true);
    assert.equal(app.document.querySelector('#wuep-status').textContent, '3 visible / 3 total');
    assert.equal(app.row('native-hidden').classList.contains('wuep-row-hidden'), false);

    trigger.click();
    assert.equal(panel.hidden, false);
    assert.ok(trigger.classList.contains('wuep-open'));
    app.document.querySelector('input[name="classType"][value="face"]').click();
    app.flush();
    assert.equal(app.row('tuesday-fun').classList.contains('wuep-row-hidden'), true);
    assert.equal(app.row('monday-face').classList.contains('wuep-row-hidden'), false);
    assert.equal(app.row('native-hidden').classList.contains('wuep-row-hidden'), false);
    assert.equal(app.document.querySelector('#wuep-status').textContent, '2 visible / 3 total');
    assert.equal(app.saved.at(-1).wuep_filters_v6.classType, 'face');

    app.document.querySelector('.wuep-day[data-day="TUE"] input').click();
    app.flush();
    assert.equal(app.row('tuesday-face').classList.contains('wuep-row-hidden'), true);
    assert.equal(app.document.querySelector('#wuep-status').textContent, '1 visible / 3 total');
    assert.deepEqual(Array.from(app.saved.at(-1).wuep_filters_v6.selectedDays), ['MON', 'WED', 'THU', 'FRI', 'SAT']);

    const start = app.document.querySelector('#wuep-time-start');
    start.value = '600';
    start.dispatchEvent(new app.window.Event('input', { bubbles: true }));
    app.flush();
    assert.equal(app.row('monday-face').classList.contains('wuep-row-hidden'), true);
    assert.equal(app.document.querySelector('#wuep-status').textContent, '0 visible / 3 total');
    assert.equal(app.document.querySelector('#wuep-range-label').textContent, '10:00 → 21:30');
  } finally {
    app.close();
  }
});

test('storage disable hides the extension UI and clears only extension row classes', () => {
  const app = loadSchedule();
  try {
    app.flush();
    app.document.querySelector('input[name="classType"][value="face"]').click();
    app.flush();
    assert.ok(app.row('tuesday-fun').classList.contains('wuep-row-hidden'));
    assert.ok(app.document.querySelector('.wuep-native-hidden'));

    app.enabled(false);
    assert.equal(app.document.querySelector('#wuep-trigger').style.display, 'none');
    assert.equal(app.document.querySelector('#wuep-panel').hidden, true);
    assert.equal(app.document.querySelector('.wuep-native-hidden'), null);
    assert.equal(app.row('tuesday-fun').classList.contains('wuep-row-hidden'), false);
    assert.equal(app.row('native-hidden').parentElement.style.display, 'none');
    assert.equal(app.row('native-hidden').classList.contains('wuep-row-hidden'), false);
  } finally {
    app.close();
  }
});
