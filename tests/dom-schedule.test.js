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

function loadSchedule(pageMarkup = markup, url = 'https://ecampus.whatsup.es/Api/ScheduleAClass') {
  const dom = new JSDOM(pageMarkup, {
    url,
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
  if (sample) Object.defineProperty(sample, 'offsetParent', { get: () => sample.parentElement });
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
    assert.equal(app.document.querySelector('.wuep-calendar'), null);
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

function confirmedRow({ id, title, heading, action }) {
  return `<app-schedule-row id="${id}"><app-schedule-info>
    <h3 class="sr-only">${heading}</h3>
    <div class="title">${title}</div>
    <div class="week-day">Friday</div>
    <div class="hour">17:00</div>
    <div class="buttons"><ion-button>${action}</ion-button></div>
  </app-schedule-info></app-schedule-row>`;
}

function madridYear(month, day) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date());
  const value = (type) => Number(parts.find((part) => part.type === type).value);
  const today = { year: value('year'), month: value('month'), day: value('day') };
  const past = month < today.month || (month === today.month && day < today.day);
  return past ? today.year + 1 : today.year;
}

test('confirmed classes link to a public Google Calendar template', () => {
  const schoolAddress = "What's Up!, Rambla Just Oliveras, 53, 08901 L'Hospitalet de Llobregat, Barcelona";
  const year = madridYear(11, 19);
  const dates = `${year}1119T203000/${year}1119T213000`;
  const page = `
    <app-sub-menu-buttons><a><span class="submenu-item">School</span></a></app-sub-menu-buttons>
    ${confirmedRow({
      id: 'booked',
      title: 'Games (07-12)',
      heading: 'Games (07-12), Thursday November 19, 20:30, face-to-face',
      action: 'Cancel class'
    })}
    ${confirmedRow({
      id: 'open',
      title: 'Face to Face - Advanced',
      heading: 'Face to Face - Advanced, Thursday November 19, 13:00',
      action: 'Schedule class'
    })}`;

  const readLink = (url) => {
    const app = loadSchedule(page, url);
    app.flush();
    const link = app.document.querySelector('#booked .wuep-calendar');
    const params = link ? new URL(link.getAttribute('href')).searchParams : null;
    const result = {
      openHasLink: Boolean(app.document.querySelector('#open .wuep-calendar')),
      tag: link?.tagName || '',
      size: link?.getAttribute('size') || '',
      expand: link?.getAttribute('expand') || '',
      text: link?.textContent || '',
      target: link?.getAttribute('target') || '',
      rel: link?.getAttribute('rel') || '',
      action: params?.get('action') || '',
      title: params?.get('text') || '',
      dates: params?.get('dates') || '',
      zone: params?.get('ctz') || '',
      location: params?.get('location') || ''
    };
    app.enabled(false);
    result.removedWhenDisabled = app.document.querySelector('.wuep-calendar') == null;
    app.close();
    return result;
  };

  const home = readLink('https://ecampus.whatsup.es/home');
  assert.equal(home.openHasLink, false);
  assert.equal(home.tag, 'ION-BUTTON');
  assert.equal(home.size, 'extended');
  assert.equal(home.expand, 'full');
  assert.equal(home.text, 'Add to calendar');
  assert.equal(home.target, '_blank');
  assert.equal(home.rel, 'noopener noreferrer');
  assert.equal(home.action, 'TEMPLATE');
  assert.equal(home.title, 'Games (07-12)');
  assert.equal(home.dates, dates);
  assert.equal(home.zone, 'Europe/Madrid');
  assert.equal(home.location, schoolAddress);
  assert.equal(home.removedWhenDisabled, true);

  const school = readLink('https://ecampus.whatsup.es/Api/ScheduleAClassSchool');
  assert.equal(school.location, schoolAddress);
  const schoolOnly = loadSchedule(
    confirmedRow({
      id: 'booked',
      title: 'Chat with a teacher (07-12)',
      heading: 'Chat with a teacher (07-12), Wednesday November 25, 10:00',
      action: 'Cancel class'
    }),
    'https://ecampus.whatsup.es/Api/ScheduleAClassSchool'
  );
  schoolOnly.flush();
  assert.equal(
    new URL(schoolOnly.document.querySelector('.wuep-calendar').getAttribute('href')).searchParams.get('location'),
    schoolAddress
  );
  schoolOnly.close();

  const live = readLink('https://ecampus.whatsup.es/Api/ScheduleAClassLive');
  assert.equal(live.dates, dates);
  assert.equal(live.location, '');
});
