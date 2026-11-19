const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = (name) => fs.readFileSync(path.join(__dirname, '..', 'src', name), 'utf8');
const plain = (value) => JSON.parse(JSON.stringify(value));

function loadExtractor(window = {}) {
  vm.runInNewContext(source('snack-extract.js'), { window });
  return window.__wuepExtractSnackHelpers;
}

test('situation script uses the explicitly identified script page and deduplicates lines', () => {
  const extract = loadExtractor();
  const helpers = extract({
    snackExercises: {
      snackId: 'SITUATION_1',
      children: [
        {
          type: 'exercisesPage', snackId: 'SITUATION_SCRIPT',
          children: [
            { data: { lines: [{ person: 'Alex', text: 'Hello   there' }] } },
            { data: { items: [{ speaker: 'Alex', line: 'Hello there' }, { role: 'Sam', statement: 'Hi!' }] } }
          ]
        },
        { type: 'exercisesPage', children: [{ data: { lines: [{ text: 'Not the script' }] } }] }
      ]
    }
  });

  assert.equal(helpers.snackId, 'SITUATION_1');
  assert.deepEqual(plain(helpers.situationScript), [
    { speaker: 'Alex', line: 'Hello there' },
    { speaker: 'Sam', line: 'Hi!' }
  ]);
});

test('situation fallback chooses the last extractable page without questions', () => {
  const extract = loadExtractor();
  const helpers = extract({ snackId: 'SITUATION', children: [
    { type: 'exercisesPage', children: [{ data: { statement: 'Earlier' } }] },
    { type: 'exercisesPage', children: [{ type: 'fillGap', data: { statement: 'Question' } }] },
    { type: 'exercisesPage', children: [{ data: { statement: { en: '  Later   line ', es: 'Otra' } } }] }
  ] });

  assert.deepEqual(plain(helpers.situationScript), [{ speaker: '', line: 'Later line' }]);
});

test('speech statements use the lab page, omitting true/false and duplicate statements', () => {
  const extract = loadExtractor();
  const helpers = extract({ snackId: 'SPEECHLAB', children: [
    { type: 'exercisesPage', snackId: 'SPEECHLAB_LAB', children: [
      { type: 'fillGap', data: { statement: '  Practice   this  ' } },
      { type: 'wordOrder', data: { statement: 'Practice this' } },
      { type: 'trueOrFalse', data: { statement: 'Omitted question' } },
      { snackId: 'VIDEO_CLIP', data: { statement: 'Omitted video' } }
    ] },
    { data: { statement: 'Outside the lab' } }
  ] });

  assert.deepEqual(plain(helpers.speechStatements), ['Practice this']);
});

test('speech fallback reads first valid answer from non-lab Speech Lab nodes', () => {
  const extract = loadExtractor();
  const helpers = extract({ snackId: 'SPEECHLAB', children: [{
    snackId: 'SPEECHLAB_TASK',
    data: { validAndStudentAnswers: [
      { validAnswers: [{ value: 'First answer' }, { value: 'Ignored alternative' }] },
      { validAnswers: [{ value: 'Second answer' }] }
    ] }
  }] });

  assert.deepEqual(plain(helpers.speechStatements), ['First answer', 'Second answer']);
  assert.deepEqual(plain(extract(null)), {
    snackId: '', situationScript: [], speechStatements: [], trueFalseValues: {}, trueFalseAnswers: []
  });
});

test('situation listen and fill keeps sentences whose ids contain video', () => {
  const extract = loadExtractor();
  const helpers = extract({ snackId: 'SITUATION', children: [
    { type: 'exercisesPage', snackId: 'NC_VIDEO_112_SNACK2', children: [
      { type: 'listenAndFill', snackId: 'NC_VIDEO_112_SNACK2_0', data: {
        validAndStudentAnswers: [{ validAnswers: [{ value: 'Any idea how you may have injured your back?' }] }]
      } }
    ] },
    { type: 'exercisesPage', snackId: 'NC_VIDEO_112_SCRIPT', data: { statement: 'Not a dictation sentence' } },
    { type: 'trueOrFalse', snackId: 'NC_VIDEO_112_SNACK1', data: { statement: 'Not a dictation sentence either' } }
  ] });

  assert.deepEqual(plain(helpers.speechStatements), ['Any idea how you may have injured your back?']);
});

test('situation true or false keeps submitted booleans and the visible-label map', () => {
  const extract = loadExtractor();
  const helpers = extract({ snackId: 'SITUATION', children: [
    { data: { trueFalseValues: { true: 'False', false: 'True' } } },
    { type: 'trueOrFalse', snackId: 'NC_VIDEO_110_SNACK1_0', data: {
      statement: 'The dress is ready.',
      validAndStudentAnswers: [{ validAnswers: [{ value: false }] }]
    } },
    { type: 'trueOrFalse', data: {
      validAndStudentAnswers: [{ validAnswers: [{ value: true }] }]
    } }
  ] });

  assert.deepEqual(plain(helpers.trueFalseValues), { true: 'False', false: 'True' });
  assert.deepEqual(plain(helpers.trueFalseAnswers), [false, true]);
  assert.deepEqual(plain(helpers.speechStatements), []);
});

test('fetch launch capture persists and posts helpers without replacing the response', async () => {
  const stored = new Map();
  const messages = [];
  const response = { clone: () => ({ text: async () => JSON.stringify({ snackExercises: { snackId: 'SPEECHLAB_42' } }) }) };
  const originalFetch = async () => response;
  const window = { fetch: originalFetch, postMessage: (message, target) => messages.push({ message, target }) };
  const sessionStorage = { setItem: (key, value) => stored.set(key, value) };
  class XMLHttpRequest {
    open() {}
    send() {}
    addEventListener() {}
  }

  loadExtractor(window);
  vm.runInNewContext(source('exercise-bridge.js'), { window, sessionStorage, XMLHttpRequest });
  const returned = await window.fetch('https://example.test/OnlineCourseLaunch');
  await new Promise(setImmediate);

  assert.equal(returned, response);
  assert.equal(JSON.parse(stored.get('wuep_helpers:SPEECHLAB_42')).snackId, 'SPEECHLAB_42');
  assert.equal(messages.length, 1);
  assert.equal(messages[0].message.type, 'snack-helpers');
  assert.equal(messages[0].message.key, 'wuep_helpers:SPEECHLAB_42');
  assert.equal(messages[0].target, '*');

  await window.fetch('https://example.test/other');
  await new Promise(setImmediate);
  assert.equal(messages.length, 1);
  assert.equal(window.__wuepLaunchBridge, true);
});

test('XHR launch capture tolerates session storage failures and still posts helpers', () => {
  const messages = [];
  const window = { fetch: async () => ({}), postMessage: (message) => messages.push(message) };
  const sessionStorage = { setItem: () => { throw new Error('quota'); } };
  class XMLHttpRequest {
    listeners = {};
    open(method, url) { this.url = url; }
    send() { this.responseText = JSON.stringify({ snackExercises: { snackId: 'SITUATION_7' } }); this.listeners.load(); }
    addEventListener(type, listener) { this.listeners[type] = listener; }
  }

  loadExtractor(window);
  vm.runInNewContext(source('exercise-bridge.js'), { window, sessionStorage, XMLHttpRequest });
  const request = new XMLHttpRequest();
  request.open('GET', '/OnlineCourseLaunch');
  request.send();

  assert.equal(messages.length, 1);
  assert.equal(messages[0].key, 'wuep_helpers:SITUATION_7');
  assert.equal(window.__wuepLastHelpers.snackId, 'SITUATION_7');
});
