const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'content.js'), 'utf8');

function classList() {
  const classes = new Set();
  return {
    contains: (name) => classes.has(name),
    add: (name) => classes.add(name),
    remove: (name) => classes.delete(name),
    toggle: (name, force) => force ? classes.add(name) : classes.delete(name)
  };
}

function row({ title, day = 'Monday', time = '09:30', nativeHidden = false }) {
  const cells = new Map([
    ['app-schedule-info .title', title == null ? null : { textContent: title }],
    ['app-schedule-info .week-day', { textContent: day }],
    ['app-schedule-info .hour', { textContent: time }]
  ]);
  return {
    classList: classList(),
    querySelector: (selector) => cells.get(selector),
    textContent: title || '',
    nodeType: 1,
    parentElement: null,
    nativeHidden,
    getBoundingClientRect: () => ({ width: 100, height: 20 })
  };
}

function harness(rows, pathname = '/Api/ScheduleAClass') {
  const window = { getComputedStyle: (element) => ({
    display: element.nativeHidden ? 'none' : 'block', visibility: 'visible'
  }) };
  const document = {
    readyState: 'loading',
    addEventListener() {},
    querySelectorAll: (selector) => selector === 'app-schedule-row' ? rows : [],
    querySelector: () => null
  };
  const context = { window, document, location: { pathname } };
  // Characterization-only probe: the original content script keeps its filter
  // implementation inside an IIFE and does not expose a test API.
  const instrumented = source.replace(/\}\)\(\);\s*$/, `
    window.__characterizeSchedule = { state, applyFiltersNow };
  })();`);
  assert.notEqual(instrumented, source);
  vm.runInNewContext(instrumented, context);
  return window.__characterizeSchedule;
}

test('default schedule filtering retains matching weekday and inclusive time endpoints', () => {
  const rows = [
    row({ title: 'Face to Face', time: '09:30' }),
    row({ title: 'Have Fun', day: 'Saturday', time: '21:30' }),
    row({ title: 'Face to Face', day: 'Sunday' }),
    row({ title: 'Face to Face', time: '09:00' }),
    row({ title: 'Face to Face', time: 'invalid' }),
    row({ title: '' })
  ];
  harness(rows).applyFiltersNow();
  assert.deepEqual(rows.map((item) => item.classList.contains('wuep-row-hidden')),
    [false, false, true, true, true, true]);
});

test('class type and selected days combine, while natively hidden rows stay untouched', () => {
  const rows = [
    row({ title: 'Face to Face', day: 'Monday' }),
    row({ title: 'Have Fun', day: 'Tuesday' }),
    row({ title: 'Have Fun', day: 'Monday' }),
    row({ title: 'Have Fun', day: 'Monday', nativeHidden: true })
  ];
  const schedule = harness(rows);
  schedule.state.classType = 'havefun';
  schedule.state.selectedDays = ['MON'];
  schedule.applyFiltersNow();
  assert.deepEqual(rows.map((item) => item.classList.contains('wuep-row-hidden')),
    [true, true, false, false]);
});

test('filter artifacts are cleared when disabled or outside schedule routes', () => {
  const disabledRow = row({ title: 'Have Fun' });
  disabledRow.classList.add('wuep-row-hidden');
  const disabled = harness([disabledRow]);
  disabled.state.enabled = false;
  disabled.applyFiltersNow();
  assert.equal(disabledRow.classList.contains('wuep-row-hidden'), false);

  const otherRow = row({ title: 'Have Fun' });
  otherRow.classList.add('wuep-row-hidden');
  harness([otherRow], '/Api/Other').applyFiltersNow();
  assert.equal(otherRow.classList.contains('wuep-row-hidden'), false);
});
