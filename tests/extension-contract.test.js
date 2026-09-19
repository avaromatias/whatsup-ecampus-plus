const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

test('temporary pre-bundling manifest baseline preserves page-world bridge order and isolated timing', () => {
  assert.equal(manifest.manifest_version, 3);
  // This exact source-file layout is deliberately temporary: replace it with
  // semantic entrypoint assertions when the refactor introduces bundles.
  assert.deepEqual(manifest.content_scripts.map(({ matches, js, run_at, world }) => ({
    matches, js, run_at, world: world || 'ISOLATED'
  })), [
    { matches: ['https://ecampus.whatsup.es/Api/ScheduleAClass*'], js: ['src/content.js'], run_at: 'document_idle', world: 'ISOLATED' },
    { matches: ['https://ecampus.whatsup.es/snacks/*'], js: ['src/snack-extract.js', 'src/exercise-bridge.js'], run_at: 'document_start', world: 'MAIN' },
    { matches: ['https://ecampus.whatsup.es/*'], js: ['src/exercise.js'], run_at: 'document_idle', world: 'ISOLATED' }
  ]);
  assert.equal(manifest.action.default_popup, 'popup.html');
  assert.ok(manifest.permissions.includes('storage'));
  for (const script of manifest.content_scripts) {
    for (const file of [...script.js, ...(script.css || [])]) {
      assert.ok(fs.existsSync(path.join(root, file)), `${file} must exist`);
    }
  }
});

function loadPopup(stored) {
  const elements = new Map(['enabled', 'status', 'version'].map((id) => [id, {
    checked: false, textContent: '', listeners: {},
    addEventListener(name, listener) { this.listeners[name] = listener; }
  }]));
  let saved;
  const chrome = {
    runtime: { getManifest: () => ({ version: manifest.version }) },
    storage: { sync: {
      get: (_keys, callback) => callback(stored),
      set: (value, callback) => { saved = value; callback(); }
    } }
  };
  const document = { getElementById: (id) => elements.get(id) };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'popup.js'), 'utf8'), { chrome, document });
  return { elements, saved: () => saved };
}

test('popup defaults to enabled, shows version, and writes toggled sync preference', () => {
  const popup = loadPopup({});
  assert.equal(popup.elements.get('enabled').checked, true);
  assert.equal(popup.elements.get('status').textContent, 'Enhancements are enabled.');
  assert.equal(popup.elements.get('version').textContent, `v${manifest.version}`);
  popup.elements.get('enabled').checked = false;
  popup.elements.get('enabled').listeners.change();
  assert.deepEqual(JSON.parse(JSON.stringify(popup.saved())), { wuep_enabled: false });
  assert.equal(popup.elements.get('status').textContent, 'Enhancements are disabled.');
});

test('popup honors explicitly disabled sync preference', () => {
  const popup = loadPopup({ wuep_enabled: false });
  assert.equal(popup.elements.get('enabled').checked, false);
  assert.equal(popup.elements.get('status').textContent, 'Enhancements are disabled.');
});
