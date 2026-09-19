const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'dist', 'exercise.js'), 'utf8');
const plain = (value) => JSON.parse(JSON.stringify(value));

function loadExercise(pathname = '/snacks/COURSE/PAGE', { boot = false, enabled = true, containers = [] } = {}) {
  const values = new Map();
  const frames = [];
  const listeners = {};
  let storageChanged;
  const location = { pathname };
  const document = {
    readyState: boot ? 'complete' : 'loading',
    body: { classList: { remove() {} }, querySelectorAll: () => [] },
    addEventListener: (name, listener) => { listeners[name] = listener; },
    createElement: () => ({
      dataset: {}, children: [], listeners: {}, parentNode: null,
      addEventListener(name, listener) { this.listeners[name] = listener; },
      appendChild(child) { this.children.push(child); },
      querySelectorAll: () => [],
      remove() { this.parentNode = null; }
    }),
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: (selector) => selector === '.fill-container' ? containers : []
  };
  const window = { addEventListener: (name, listener) => { listeners[name] = listener; } };
  const history = {
    pushState(_state, _title, url) { location.pathname = url; },
    replaceState(_state, _title, url) { location.pathname = url; }
  };
  const chrome = { storage: {
    sync: { get: (_keys, callback) => callback({ wuep_enabled: enabled }) },
    onChanged: { addListener: (listener) => { storageChanged = listener; } }
  } };
  class MutationObserver {
    observe() {}
    disconnect() {}
  }
  class Input {
    constructor() { this.value = ''; this.events = []; this.isConnected = true; }
    dispatchEvent(event) { this.events.push(event.type); }
    setSelectionRange() {}
  }
  const context = {
    window, document, location, history, chrome, MutationObserver,
    HTMLInputElement: Input, HTMLTextAreaElement: class {}, HTMLElement: class {},
    Event: class { constructor(type) { this.type = type; } },
    requestAnimationFrame: (callback) => frames.push(callback),
    sessionStorage: {
      getItem: (key) => values.get(`session:${key}`) || null,
      setItem: (key, value) => values.set(`session:${key}`, value)
    },
    localStorage: {
      getItem: (key) => values.get(`local:${key}`) || null,
      setItem: (key, value) => values.set(`local:${key}`, value)
    }
  };
  // Expose the private closure only in this VM. The production bundle remains
  // untouched; the test hooks into its inner content-script closure.
  const instrumented = source.replace(/\n  \}\)\(\);\s*\n\}\)\(\);\s*$/, `
    window.__characterizeExercise = {
      state, parseTokens, parseInputTokens, extractDisplayPunctuation, tokenizeWords,
      remapWithBaseCasing, toSentence, loadReorderPersisted, saveReorderPersisted,
      answerFromScript, saveHelpersCache, loadHelpersCache, onHelpersMessage
    };
  })();
})();`);
  assert.notEqual(instrumented, source, 'bundled exercise closure must remain recognizable');
  vm.runInNewContext(instrumented, context);
  return {
    window, location, history, listeners, values,
    Input,
    exercise: window.__characterizeExercise,
    change: (changes, area = 'sync') => storageChanged(changes, area),
    flush: () => { while (frames.length) frames.shift()(); }
  };
}

function fakeReorderContainer(input) {
  const classes = new Set();
  const text = { textContent: '?\nhello | world', dataset: {} };
  let bank = null;
  const anchor = { parentNode: {
    insertBefore(element) { bank = element; element.parentNode = this; }
  } };
  return {
    text, get bank() { return bank; },
    classList: { add: (name) => classes.add(name), remove: (name) => classes.delete(name), contains: (name) => classes.has(name) },
    querySelectorAll: (selector) => selector === '.question-text' ? [text] : [],
    querySelector: (selector) => selector === '.wuep-reorder-bank' ? bank : selector === '.fill-gap' ? anchor : selector.includes('snack-gap') ? input : null
  };
}

test('reorder tokens retain base casing, duplicate tokens, and displayed punctuation', () => {
  const { exercise } = loadExercise();
  assert.deepEqual(plain(exercise.parseTokens('?\nhello | HELLO | world.')), ['hello', 'HELLO', 'world.']);
  assert.equal(exercise.extractDisplayPunctuation('?\nhello | world'), '?');
  assert.deepEqual(plain(exercise.parseInputTokens('Hello hello world.')), ['Hello', 'hello', 'world']);
  assert.deepEqual(plain(exercise.remapWithBaseCasing(['HELLO', 'hello', 'WORLD'], ['hello', 'HELLO', 'world'])),
    ['hello', 'HELLO', 'world']);
  assert.equal(exercise.toSentence(['hello', 'HELLO', 'world']), 'Hello HELLO world');
});

test('reorder persistence is keyed by the initial path and tolerates corrupt storage', () => {
  const harness = loadExercise('/snacks/COURSE/ONE');
  harness.exercise.state.reorderItems = [{ id: '0', tokens: ['Hello', 'world'] }];
  harness.exercise.saveReorderPersisted();
  assert.deepEqual(JSON.parse(harness.values.get('local:wuep_reorder_state:/snacks/COURSE/ONE')),
    { 0: ['Hello', 'world'] });
  harness.location.pathname = '/snacks/COURSE/TWO';
  assert.deepEqual(plain(harness.exercise.loadReorderPersisted()), { 0: ['Hello', 'world'] });
  harness.values.set('local:wuep_reorder_state:/snacks/COURSE/ONE', '{bad json');
  assert.deepEqual(plain(harness.exercise.loadReorderPersisted()), {});
});

test('Situation matching chooses a full option, then extracts a cased gap from script', () => {
  const { exercise } = loadExercise();
  exercise.state.situationScript = [{ line: 'She Was Studying English yesterday.' }];
  const script = exercise.state.situationScript;
  assert.equal(exercise.answerFromScript(script, 'She', 'English yesterday', ['is', 'Was Studying']), 'Was Studying');
  assert.equal(exercise.answerFromScript(script, 'She', 'English yesterday', []), 'Was Studying');
  assert.equal(exercise.answerFromScript(script, 'unrelated', 'context', []), '');
});

test('Situation matching preserves apostrophes, punctuation fallback, and empty scripts', () => {
  const { exercise } = loadExercise();
  const script = [{ line: 'Don’t Stop, BELIEVING now!' }];
  assert.deepEqual(plain(exercise.tokenizeWords(script[0].line)), ["don't", 'stop', 'believing', 'now']);
  assert.equal(exercise.answerFromScript(script, 'Don’t', 'now', []), 'stop believing');
  assert.equal(exercise.answerFromScript(script, 'missing', 'now', []), 'BELIEVING');
  assert.equal(exercise.answerFromScript([], 'Don’t', 'now', []), '');
});

test('helpers cache keeps prior script and clean Speech Lab statements when a later payload is empty', () => {
  const harness = loadExercise('/snacks/COURSE/VIDEO_SNACK');
  harness.exercise.saveHelpersCache({
    snackId: 'COURSE', situationScript: [{ speaker: 'Alex', line: 'Hello there' }],
    speechStatements: ['Practice this sentence']
  });
  harness.exercise.saveHelpersCache({
    snackId: 'COURSE', situationScript: [], speechStatements: ['Listen: noise', 'short']
  });
  assert.deepEqual(plain(harness.exercise.loadHelpersCache()), {
    snackId: 'COURSE', situationScript: [{ speaker: 'Alex', line: 'Hello there' }],
    speechStatements: ['Practice this sentence']
  });
  assert.equal(harness.exercise.state.situationScript[0].line, 'Hello there');
});

test('Snacks lifecycle respects sync toggle, SPA navigation, and foreign storage changes', () => {
  const harness = loadExercise('/snacks/COURSE/PAGE', { boot: true, enabled: false });
  assert.equal(harness.window.__wuepExerciseProbe, 'disabled');
  assert.equal(harness.exercise.state.bootstrapped, false);
  harness.change({ wuep_enabled: { newValue: true } }, 'local');
  assert.equal(harness.exercise.state.enabled, false);
  harness.change({ wuep_enabled: { newValue: true } });
  harness.flush();
  assert.equal(harness.window.__wuepExerciseProbe, 'snacks-no-known-pattern-yet');
  harness.history.pushState({}, '', '/Api/Other');
  harness.flush();
  assert.equal(harness.exercise.state.mode, null);
  harness.history.replaceState({}, '', '/snacks/COURSE/PAGE');
  harness.flush();
  assert.equal(harness.window.__wuepExerciseProbe, 'snacks-no-known-pattern-yet');
  harness.change({ wuep_enabled: { newValue: false } });
  assert.equal(harness.window.__wuepExerciseProbe, 'disabled');
  assert.equal(harness.exercise.state.bootstrapped, false);
});

test('reorder takes precedence over rewrite and disabling removes its created bank', () => {
  const containers = [];
  const harness = loadExercise('/snacks/COURSE/PAGE', { boot: true, containers });
  // The initial empty-DOM refresh runs after fixtures are installed, like an
  // Angular view appearing after the content script has bootstrapped.
  const input = new harness.Input();
  const reorder = fakeReorderContainer(input);
  const rewriteInput = new harness.Input();
  const rewriteText = { textContent: 'Rewrite this sentence' };
  const rewrite = {
    querySelectorAll: (selector) => selector === '.question-text' ? [rewriteText] : [],
    querySelector: (selector) => selector.includes('snack-gap') ? rewriteInput : null
  };
  containers.push(reorder, rewrite);
  assert.equal(reorder.bank, null);
  harness.flush();
  assert.equal(harness.exercise.state.mode, 'reorder');
  assert.equal(harness.window.__wuepExerciseProbe, 'snacks-mounted-reorder');
  assert.equal(input.value, 'Hello world');
  assert.deepEqual(input.events, ['input', 'change']);
  assert.equal(reorder.text.textContent, '?');
  assert.equal(reorder.bank.children.length, 2);
  assert.ok(reorder.bank.parentNode);
  assert.equal(reorder.classList.contains('wuep-reorder-container'), true);
  assert.equal(rewriteInput.value, '');

  harness.change({ wuep_enabled: { newValue: false } });
  assert.equal(reorder.text.textContent, '?\nhello | world');
  assert.equal(reorder.bank.parentNode, null);
  assert.equal(reorder.classList.contains('wuep-reorder-container'), false);
  assert.equal(harness.exercise.state.mode, null);
});

test('SPA navigation away tears down an already mounted reorder mode', () => {
  const containers = [];
  const harness = loadExercise('/snacks/COURSE/PAGE', { boot: true, containers });
  const reorder = fakeReorderContainer(new harness.Input());
  containers.push(reorder);
  harness.flush();
  assert.equal(harness.exercise.state.mode, 'reorder');

  harness.history.pushState({}, '', '/Api/Other');
  harness.flush();
  assert.equal(harness.exercise.state.mode, null);
  assert.equal(reorder.text.textContent, '?\nhello | world');
  assert.equal(reorder.bank.parentNode, null);
  assert.equal(reorder.classList.contains('wuep-reorder-container'), false);
});
