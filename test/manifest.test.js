// -----------------------------------------------------------------------------
// The manifest is the contract with Gladys and the store: these tests tie it
// to the code, so a key renamed on one side only fails here. When the Gladys
// core is cloned next to this repository (~/code/Gladys), its own manifest
// validator is run too.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ACCENT_MODES,
  ACTIONS,
  BOUNDS,
  CONFIG,
  DEFAULTS,
  MAX_RECIPIENTS,
  SCENE_ACTION,
  SCENE_BUDGET,
  BUTTON_BUDGET,
  USER_AGENT,
  VERSION,
} from '../src/constants.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const manifest = JSON.parse(read('gladys-assistant-integration.json'));
const pkg = JSON.parse(read('package.json'));
const lock = JSON.parse(read('package-lock.json'));
const index = read('index.js');
const field = (key) => manifest.config_schema.find((f) => f.key === key);

function* texts(node, path = '') {
  if (Array.isArray(node)) {
    for (const [i, item] of node.entries()) yield* texts(item, `${path}[${i}]`);
  } else if (node && typeof node === 'object') {
    if ('en' in node || 'fr' in node) {
      yield [path, node];
      return;
    }
    for (const [key, value] of Object.entries(node)) yield* texts(value, `${path}.${key}`);
  }
}

function* objects(node) {
  if (Array.isArray(node)) {
    for (const item of node) yield* objects(item);
  } else if (node && typeof node === 'object') {
    yield node;
    for (const value of Object.values(node)) yield* objects(value);
  }
}

test('the store basics: a provider, France only, Gladys 5.3', () => {
  assert.equal(manifest.manifest_version, 1);
  assert.equal(manifest.type, 'provider', 'scene action and buttons only: no device, no channel');
  assert.equal(manifest.messaging, undefined, 'no reception, no communication channel');
  assert.equal(manifest.gladys_version, '>=5.3.0', 'countries needs Gladys 5.3');
  assert.deepEqual(manifest.categories, ['notifications']);
  assert.deepEqual(manifest.transports, ['cloud']);
  assert.deepEqual(manifest.countries, ['FR']);
  for (const code of manifest.countries) assert.match(code, /^[A-Z]{2}$/);
  for (const lang of ['en', 'fr']) {
    const length = manifest.description[lang].length;
    assert.ok(length >= 10 && length <= 100, `description.${lang}: ${length} characters`);
    assert.ok(read(`docs/${lang}.md`).length >= 300, `docs/${lang}.md is too short for the store`);
  }
  assert.match(manifest.description.en, /^Unofficial/);
  assert.match(manifest.description.fr, /^Non officiel/);
  assert.equal(manifest.keywords, undefined);
  assert.equal(manifest.widgets, undefined);
  assert.equal(manifest.scene_triggers, undefined, 'nothing received, no trigger');
});

test('one version everywhere, semver, never pinned', () => {
  const semver = /^\d+\.\d+\.\d+$/;
  assert.match(pkg.version, semver);
  assert.equal(manifest.version, pkg.version);
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[''].version, pkg.version);
  assert.equal(VERSION, pkg.version, 'the User-Agent version');
  assert.ok(USER_AGENT.startsWith(`gladys-smsmode/${pkg.version} `));
  assert.equal(manifest.docker_image, `ghcr.io/lm1lc3n7/gladys-smsmode:${pkg.version}`);
  assert.match(manifest.gladys_version, /^>=\d+\.\d+\.\d+$/, 'a range, never one version');
  assert.equal(pkg.scripts.test, 'node --test --test-timeout=60000');
  assert.equal(pkg.dependencies['@gladysassistant/integration-sdk'], '^0.16.0');
});

test('every text is bilingual, and the words the rules forbid are absent', () => {
  for (const [path, text] of texts(manifest)) {
    assert.ok(text.en?.trim() && text.fr?.trim(), `${path} needs en and fr`);
  }
  const all = [
    'gladys-assistant-integration.json',
    'README.md',
    'docs/en.md',
    'docs/fr.md',
    'src/i18n.js',
    'CHANGELOG.md',
    'TODO.md',
  ]
    .map(read)
    .join('\n');
  // "chiffres" (digits) is a plain word; the forms about encryption are not.
  assert.doesNotMatch(all, /chiffr(?:é|em|er|ag|an)|encrypt/i);
  assert.match('Stockée chiffrée', /chiffr(?:é|em|er|ag|an)/i);
  assert.doesNotMatch('3 à 11 lettres ou chiffres', /chiffr(?:é|em|er|ag|an)/i);
});

test('the configuration matches the code: keys, defaults, bounds, the secret', () => {
  for (const f of manifest.config_schema) {
    assert.doesNotMatch(f.key, /^gladys_/i);
    if (f.type === 'section') assert.equal(f.default, undefined);
    for (const link of f.links ?? []) assert.match(link.url, /^https:\/\//);
  }
  const keys = manifest.config_schema.filter((f) => f.type !== 'section').map((f) => f.key);
  assert.deepEqual(keys.sort(), Object.values(CONFIG).sort());
  const secret = field(CONFIG.API_KEY);
  assert.equal(secret.type, 'secret');
  assert.equal(secret.required, true);
  assert.equal(secret.default, undefined, 'never a default secret');
  assert.match(
    secret.description.fr,
    /^Gardée par Gladys dans sa base, jamais réaffichée, envoyée seulement à smsmode/,
  );
  assert.match(
    secret.description.en,
    /^Kept by Gladys in its database, never shown again, sent only to smsmode/,
  );
  for (const [key, value] of Object.entries(DEFAULTS)) assert.equal(field(key).default, value, key);
  for (const [key, [min, max]] of Object.entries(BOUNDS)) {
    assert.equal(field(key).type, 'number');
    assert.equal(field(key).min, min, key);
    assert.equal(field(key).max, max, key);
    for (const lang of ['en', 'fr'])
      assert.ok(field(key).description[lang].includes(`${max}`), key);
  }
  assert.deepEqual(
    field(CONFIG.ACCENTS).options.map((o) => o.value),
    ACCENT_MODES,
  );
  for (const lang of ['en', 'fr']) {
    assert.ok(field(CONFIG.RECIPIENTS).description[lang].includes(String(MAX_RECIPIENTS)));
  }
});

test('the buttons and the scene action match the handlers and their budgets', () => {
  assert.deepEqual(
    manifest.actions.map((a) => a.key),
    [ACTIONS.CHECK, ACTIONS.TEST],
  );
  for (const action of manifest.actions) {
    assert.ok(index.includes('ACTIONS.CHECK') && index.includes('ACTIONS.TEST'));
    assert.ok(action.timeout_seconds >= 5 && action.timeout_seconds <= 120);
  }
  const test = manifest.actions.find((a) => a.key === ACTIONS.TEST);
  assert.ok(test.timeout_seconds * 1000 > BUTTON_BUDGET + 2000);
  assert.deepEqual(
    test.fields.map((f) => f.key),
    ['phone'],
  );
  const [scene] = manifest.scene_actions;
  assert.equal(manifest.scene_actions.length, 1);
  assert.equal(scene.key, SCENE_ACTION);
  assert.ok(index.includes('onSceneAction(SCENE_ACTION'));
  assert.ok(
    scene.timeout_seconds * 1000 > SCENE_BUDGET + 2000,
    'the budget ends before Gladys gives up',
  );
  assert.deepEqual(
    scene.fields.map((f) => [f.key, f.type, f.required]),
    [
      ['text', 'string', true],
      ['recipients', 'string', false],
    ],
  );
  assert.deepEqual(
    scene.outputs.map((o) => [o.key, o.type]),
    [
      ['sent', 'number'],
      ['not_sent', 'number'],
      ['message_ids', 'string'],
      ['truncated', 'boolean'],
    ],
  );
});

test('every select option follows the core rules (label, value, unique)', () => {
  for (const node of objects(manifest)) {
    if (node.type !== 'select' || !Array.isArray(node.options)) continue;
    const values = node.options.map((o) => o.value);
    assert.equal(new Set(values).size, values.length);
    for (const option of node.options) {
      assert.ok(typeof option.value === 'string' || Number.isInteger(option.value));
      for (const lang of ['en', 'fr']) {
        const label = option.label[lang];
        assert.equal(typeof label, 'string');
        assert.ok(label.length > 0 && label === label.trim());
      }
      assert.deepEqual(Object.keys(option).sort(), ['label', 'value']);
    }
  }
  assert.equal(JSON.stringify(manifest).includes('supported_options'), false, 'no device feature');
});

test('the licence and the notices ship in the image; LICENSE names nobody', () => {
  const dockerfile = read('Dockerfile');
  assert.match(dockerfile, /COPY LICENSE THIRD_PARTY_NOTICES\.md/);
  assert.doesNotMatch(read('LICENSE'), /Copyright \d{4} [A-Z]/, 'no personal name');
  for (const file of ['README.md', 'docs/en.md', 'docs/fr.md', 'THIRD_PARTY_NOTICES.md']) {
    assert.match(read(file), /rest\.smsmode\.com/, file);
  }
});

const core = join(homedir(), 'code/Gladys/server/lib/external-integration');
test(
  'the Gladys core validator accepts the manifest',
  { skip: !existsSync(core) && 'Gladys core not cloned' },
  async (t) => {
    // In a child process and a temporary directory: requiring the core opens
    // its database files in the working directory.
    const dir = await mkdtemp(join(tmpdir(), 'smsmode-core-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const script = `
      const mod = require(${JSON.stringify(join(core, 'externalIntegration.validateManifest.js'))});
      const validate = mod.validateManifest ?? mod;
      try { validate(${JSON.stringify(manifest)}); process.exit(0); }
      catch (err) { console.log('INVALID', err.message, JSON.stringify(err.properties ?? err.errors ?? '')); process.exit(3); }
    `;
    const result = spawnSync(process.execPath, ['-e', script], {
      cwd: dir,
      encoding: 'utf8',
      timeout: 30_000,
    });
    assert.equal(
      result.status,
      0,
      result.stdout
        .split('\n')
        .filter((l) => /INVALID/.test(l))
        .join('\n'),
    );
  },
);
