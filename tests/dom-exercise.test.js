const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { JSDOM } = require('jsdom');

const source = fs.readFileSync(path.join(__dirname, '..', 'dist', 'exercise.js'), 'utf8');

function loadExercise(markup, page = 'PAGE') {
  const dom = new JSDOM(markup, {
    url: `https://ecampus.whatsup.es/snacks/COURSE/${page}`,
    runScripts: 'outside-only'
  });
  const { window } = dom;
  const frames = [];
  let onStorageChanged;

  // JSDOM has no layout. Treat fixture elements as visible, without changing
  // the extension's own visibility or mode-selection logic.
  window.Element.prototype.getClientRects = () => [{}];
  window.requestAnimationFrame = (callback) => frames.push(callback);
  window.chrome = {
    storage: {
      sync: { get: (_keys, callback) => callback({ wuep_enabled: true }) },
      onChanged: { addListener: (listener) => { onStorageChanged = listener; } }
    }
  };

  // Only the trusted local content script runs; no resource loading or page JS.
  window.eval(source);
  window.document.dispatchEvent(new window.Event('DOMContentLoaded'));

  return {
    window,
    document: window.document,
    flush() {
      let count = 0;
      while (frames.length) {
        assert.ok(++count < 20, 'refresh settled');
        frames.shift()();
      }
    },
    enabled(value) {
      onStorageChanged({ wuep_enabled: { newValue: value } }, 'sync');
      this.flush();
    },
    close() { window.close(); }
  };
}

function recordEvents(element) {
  const events = [];
  element.addEventListener('input', () => events.push('input'));
  element.addEventListener('change', () => events.push('change'));
  return events;
}

function reorderMarkup(prompt = '?\nhello | HELLO | world.') {
  return `<main><div class="fill-container"><div class="question-text">${prompt}</div>
    <div class="fill-gap"><snack-gap><input type="text"></snack-gap></div></div></main>`;
}

function dragEvent(window, type, dataTransfer) {
  const event = new window.Event(type, { bubbles: true, cancelable: true });
  event.dataTransfer = dataTransfer;
  return event;
}

test('reorder chips retain punctuation/casing, persist drag order, and clean up on disable', () => {
  const app = loadExercise(reorderMarkup());
  try {
    const input = app.document.querySelector('input');
    const events = recordEvents(input);
    app.flush();
    const prompt = app.document.querySelector('.question-text');
    const bank = app.document.querySelector('.wuep-reorder-bank');
    assert.equal(app.window.__wuepExerciseProbe, 'snacks-mounted-reorder');
    assert.equal(prompt.textContent, '?');
    assert.deepEqual(Array.from(bank.children, (chip) => chip.textContent), ['hello', 'HELLO', 'world.']);
    assert.equal(input.value, 'Hello HELLO world.');
    assert.deepEqual(events, ['input', 'change']);

    const rejectedDrop = (value, target) => target.dispatchEvent(dragEvent(app.window, 'drop', {
      getData() { return value; }
    }));
    rejectedDrop('{bad json', bank.children[1]);
    rejectedDrop(JSON.stringify({ itemId: 'another-row', from: 0 }), bank);
    assert.deepEqual(Array.from(bank.children, (chip) => chip.textContent), ['hello', 'HELLO', 'world.']);
    assert.deepEqual(events, ['input', 'change'], 'invalid and cross-item drops do not touch the input');

    const dataTransfer = {
      effectAllowed: '', value: '',
      setData(_type, value) { this.value = value; },
      getData() { return this.value; }
    };
    bank.children[0].dispatchEvent(dragEvent(app.window, 'dragstart', dataTransfer));
    assert.equal(dataTransfer.effectAllowed, 'move');
    bank.children[2].dispatchEvent(dragEvent(app.window, 'drop', dataTransfer));
    assert.deepEqual(Array.from(bank.children, (chip) => chip.textContent), ['HELLO', 'world.', 'hello']);
    assert.equal(input.value, 'HELLO world. hello');
    assert.deepEqual(events, ['input', 'change', 'input', 'change']);
    assert.deepEqual(JSON.parse(app.window.localStorage.getItem('wuep_reorder_state:/snacks/COURSE/PAGE')),
      { 0: ['HELLO', 'world.', 'hello'] });

    bank.children[0].dispatchEvent(dragEvent(app.window, 'dragstart', dataTransfer));
    bank.dispatchEvent(dragEvent(app.window, 'drop', dataTransfer));
    assert.deepEqual(Array.from(bank.children, (chip) => chip.textContent), ['world.', 'hello', 'HELLO']);
    assert.equal(input.value, 'World. hello HELLO');
    assert.deepEqual(events, ['input', 'change', 'input', 'change', 'input', 'change']);

    bank.children[2].dispatchEvent(dragEvent(app.window, 'dragstart', dataTransfer));
    bank.children[2].dispatchEvent(dragEvent(app.window, 'drop', dataTransfer));
    assert.deepEqual(events, ['input', 'change', 'input', 'change', 'input', 'change'],
      'dropping a chip on itself is a no-op');
    bank.dispatchEvent(dragEvent(app.window, 'drop', dataTransfer));
    assert.deepEqual(events, ['input', 'change', 'input', 'change', 'input', 'change', 'input', 'change'],
      'dropping the last chip on the bank still synchronizes the input');

    app.enabled(false);
    assert.equal(prompt.textContent, '?\nhello | HELLO | world.');
    assert.equal(app.document.querySelector('.wuep-reorder-bank'), null);
    assert.equal(app.document.querySelector('.wuep-reorder-container'), null);
    assert.equal(input.value, 'World. hello HELLO', 'teardown leaves the native input alone');
  } finally {
    app.close();
  }
});

test('reorder preserves an existing answer over stored tokens without input events', () => {
  const app = loadExercise(reorderMarkup('alpha | beta | gamma'));
  try {
    const input = app.document.querySelector('input');
    input.value = 'beta alpha gamma';
    const events = recordEvents(input);
    app.window.localStorage.setItem('wuep_reorder_state:/snacks/COURSE/PAGE',
      JSON.stringify({ 0: ['gamma', 'alpha', 'beta'] }));
    app.flush();
    assert.equal(input.value, 'beta alpha gamma');
    assert.deepEqual(events, []);
    assert.deepEqual(Array.from(app.document.querySelector('.wuep-reorder-bank').children, (chip) => chip.textContent),
      ['beta', 'alpha', 'gamma']);
    assert.deepEqual(JSON.parse(app.window.localStorage.getItem('wuep_reorder_state:/snacks/COURSE/PAGE')),
      { 0: ['beta', 'alpha', 'gamma'] });
  } finally {
    app.close();
  }
});

test('word bank click, clear, and disable preserve native input state and clean UI', () => {
  const app = loadExercise(`
    <main><ul class="answers"><li>apple</li><li>pear</li></ul>
      <input type="text"><input type="text"></main>`);
  try {
    app.flush();
    const [first, second] = app.document.querySelectorAll('input');
    const [apple, pear] = app.document.querySelectorAll('li');
    const events = recordEvents(first);
    assert.equal(app.window.__wuepExerciseProbe, 'snacks-mounted-word-list');
    assert.equal(app.document.querySelectorAll('.wuep-input-wrap').length, 2);

    apple.click();
    assert.equal(first.value, 'apple');
    assert.deepEqual(events, ['input', 'change']);
    assert.ok(apple.classList.contains('wuep-word-used'));
    assert.equal(app.document.activeElement, second);

    first.parentElement.querySelector('.wuep-clear-btn').click();
    assert.equal(first.value, '');
    assert.deepEqual(events, ['input', 'change', 'input', 'change']);
    assert.equal(first.hasAttribute('data-wuep-word-id'), false);
    assert.equal(apple.classList.contains('wuep-word-used'), false);

    pear.click();
    assert.equal(first.value, 'pear');
    app.enabled(false);
    assert.equal(app.window.__wuepExerciseProbe, 'disabled');
    assert.equal(first.value, 'pear', 'disabling does not erase user input');
    assert.equal(app.document.querySelector('.wuep-input-wrap'), null);
    assert.equal(pear.classList.contains('wuep-word-item'), false);
    pear.click();
    assert.equal(second.value, '', 'disabled bank has no click behavior');
  } finally {
    app.close();
  }
});

test('rewrite prefills only empty controls, fires input/change, and removes its marker on disable', () => {
  const app = loadExercise(`
    <main>
      <div class="fill-container"><div class="question-text">Rewrite this sentence.</div>
        <snack-gap><input type="text"></snack-gap></div>
      <div class="fill-container"><div class="question-text">Keep this answer.</div>
        <snack-gap><input type="text" value="My own answer"></snack-gap></div>
    </main>`);
  try {
    const [first, second] = app.document.querySelectorAll('input');
    const events = recordEvents(first);
    app.flush();
    assert.equal(app.window.__wuepExerciseProbe, 'snacks-mounted-rewrite');
    assert.equal(first.value, 'Rewrite this sentence.');
    assert.equal(second.value, 'My own answer');
    assert.deepEqual(events, ['input', 'change']);
    assert.equal(first.dataset.wuepRewritePrefilled, '1');
    assert.equal(second.dataset.wuepRewritePrefilled, '1');

    app.enabled(false);
    assert.equal(first.hasAttribute('data-wuep-rewrite-prefilled'), false);
    assert.equal(second.hasAttribute('data-wuep-rewrite-prefilled'), false);
    assert.equal(first.value, 'Rewrite this sentence.', 'teardown does not clear prefill');
    app.enabled(true);
    assert.equal(app.window.__wuepExerciseProbe, 'snacks-mounted-rewrite');
    assert.deepEqual(events, ['input', 'change'], 're-enabling does not overwrite existing value');
  } finally {
    app.close();
  }
});

test('rewrite ignores split prompts and choice-based exercises', () => {
  const cases = [
    `<div class="fill-container"><span class="question-text">Before</span><snack-gap><input type="text"></snack-gap><span class="question-text">after</span></div>`,
    `<div class="fill-container"><span class="question-text">Rewrite ____ here.</span><snack-gap><input type="text"></snack-gap></div>`,
    `<div class="fill-container"><span class="question-text">Rewrite this.</span><snack-gap><input type="text"></snack-gap><span class="option">A</span></div>`,
    `<ul class="answers"><li>word</li><li>bank</li></ul><div class="fill-container"><span class="question-text">Rewrite this.</span><snack-gap><input type="text"></snack-gap></div>`
  ];

  cases.forEach((markup) => {
    const app = loadExercise(`<main>${markup}</main>`);
    try {
      const input = app.document.querySelector('input');
      const events = recordEvents(input);
      app.flush();
      assert.notEqual(app.window.__wuepExerciseProbe, 'snacks-mounted-rewrite');
      assert.equal(input.value, '');
      assert.equal(input.hasAttribute('data-wuep-rewrite-prefilled'), false);
      assert.deepEqual(events, []);
    } finally {
      app.close();
    }
  });
});

test('rewrite supports editable and textarea controls without replacing their existing answers', () => {
  const app = loadExercise(`<main>
    <div class="fill-container"><div class="question-text">  Editable   prompt.  </div>
      <snack-gap><div class="input" contenteditable="true"></div></snack-gap></div>
    <div class="fill-container"><div class="question-text">Textarea prompt.</div>
      <snack-gap><textarea>My answer</textarea></snack-gap></div>
  </main>`);
  try {
    const editable = app.document.querySelector('[contenteditable]');
    const textarea = app.document.querySelector('textarea');
    const editableEvents = recordEvents(editable);
    const textareaEvents = recordEvents(textarea);
    app.flush();
    assert.equal(editable.textContent, 'Editable prompt.');
    assert.equal(textarea.value, 'My answer');
    assert.deepEqual(editableEvents, ['input', 'change']);
    assert.deepEqual(textareaEvents, []);
    assert.equal(editable.dataset.wuepRewritePrefilled, '1');
    assert.equal(textarea.dataset.wuepRewritePrefilled, '1');
  } finally {
    app.close();
  }
});

test('rewrite removes its marker on SPA exit and remounts without replacing an answer', () => {
  const app = loadExercise(`<main><div class="fill-container"><div class="question-text">Original prompt.</div>
    <snack-gap><input type="text"></snack-gap></div></main>`);
  try {
    const input = app.document.querySelector('input');
    const events = recordEvents(input);
    app.flush();
    assert.equal(input.value, 'Original prompt.');
    assert.equal(input.dataset.wuepRewritePrefilled, '1');

    input.value = 'My answer';
    app.window.history.pushState({}, '', '/Api/Other');
    app.flush();
    assert.equal(input.hasAttribute('data-wuep-rewrite-prefilled'), false);
    assert.equal(input.value, 'My answer');

    app.window.history.pushState({}, '', '/snacks/COURSE/PAGE');
    app.flush();
    assert.equal(app.window.__wuepExerciseProbe, 'snacks-mounted-rewrite');
    assert.equal(input.dataset.wuepRewritePrefilled, '1');
    assert.equal(input.value, 'My answer');
    assert.deepEqual(events, ['input', 'change']);
  } finally {
    app.close();
  }
});

test('Speech Lab completion buttons apply bridge-delivered statements and teardown their wrappers', () => {
  const app = loadExercise(`
    <main><form><snack-gap><input type="text"></snack-gap>
      <snack-gap><input type="text"></snack-gap></form></main>`, 'UNIT_SPEECHLAB_DICTATION');
  try {
    // The bridge may arrive after the content script bootstraps.
    app.window.dispatchEvent(new app.window.MessageEvent('message', {
      source: app.window,
      data: {
        source: 'wuep-ecampus-plus', type: 'snack-helpers',
        helpers: { snackId: 'COURSE', speechStatements: ['The first sentence.', 'The second sentence.'] }
      }
    }));
    app.flush();
    const [first, second] = app.document.querySelectorAll('input');
    const firstEvents = recordEvents(first);
    const secondEvents = recordEvents(second);
    assert.equal(app.window.__wuepExerciseProbe, 'snacks-mounted-speech-lab');
    assert.equal(first.value, '');
    assert.equal(app.document.querySelectorAll('.wuep-complete-one').length, 2);

    app.document.querySelector('.wuep-complete-one').click();
    assert.equal(first.value, 'The first sentence.');
    assert.deepEqual(firstEvents, ['input', 'change']);
    assert.equal(second.value, '');

    app.document.querySelector('#wuep-complete-all').click();
    assert.equal(second.value, 'The second sentence.');
    assert.deepEqual(secondEvents, ['input', 'change']);
    app.enabled(false);
    assert.equal(app.document.querySelector('.wuep-complete-one'), null);
    assert.equal(app.document.querySelector('#wuep-complete-all'), null);
    assert.equal(app.document.querySelectorAll('snack-gap > input').length, 2);
    assert.equal(first.value, 'The first sentence.');
  } finally {
    app.close();
  }
});

test('Situation script opens from its FAB and completes a contextual gap', () => {
  const app = loadExercise(`
    <main><form><div class="fill-container">
      <span class="question-text">I bought</span>
      <snack-gap><input type="text"></snack-gap>
      <span class="question-text">yesterday.</span>
    </div></form></main>`, 'UNIT_VIDEO_SNACK');
  try {
    app.window.dispatchEvent(new app.window.MessageEvent('message', {
      source: app.window,
      data: {
        source: 'wuep-ecampus-plus', type: 'snack-helpers',
        helpers: { snackId: 'COURSE', situationScript: [{ speaker: 'A', line: 'I bought fresh apples yesterday.' }] }
      }
    }));
    app.flush();
    const input = app.document.querySelector('input');
    const events = recordEvents(input);
    assert.equal(app.window.__wuepExerciseProbe, 'snacks-mounted-situation-script');
    assert.ok(app.document.querySelector('#wuep-script-fab'));
    assert.equal(app.document.querySelector('#wuep-script-panel'), null);

    app.document.querySelector('#wuep-script-fab').click();
    assert.match(app.document.querySelector('#wuep-script-panel').textContent, /fresh apples/);
    app.document.querySelector('.wuep-complete-one').click();
    assert.equal(input.value, 'fresh apples');
    assert.deepEqual(events, ['input', 'change']);

    app.document.querySelector('.wuep-script-toggle').click();
    assert.equal(app.document.querySelector('#wuep-script-panel'), null);
    assert.ok(app.document.querySelector('#wuep-script-fab'));
    app.enabled(false);
    assert.equal(app.document.querySelector('#wuep-script-fab'), null);
    assert.equal(app.document.querySelector('.wuep-complete-one'), null);
    assert.equal(input.value, 'fresh apples');
  } finally {
    app.close();
  }
});
