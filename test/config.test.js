import { test } from 'node:test';
import assert from 'node:assert/strict';
import { integerOption, normalizeConfig, validKey, validSender } from '../src/config.js';

test('integer options: strict, bounded, defaults on anything else', () => {
  assert.equal(integerOption(50, 'max_sms_per_hour'), 50);
  assert.equal(integerOption('50', 'max_sms_per_hour'), 50);
  assert.equal(integerOption(0, 'max_sms_per_hour'), 1);
  assert.equal(integerOption(-5, 'max_sms_per_hour'), 1);
  assert.equal(integerOption(1e9, 'max_sms_per_hour'), 200);
  assert.equal(integerOption('', 'max_sms_per_hour'), 20, "'' is not 0");
  assert.equal(integerOption(null, 'max_sms_per_hour'), 20);
  assert.equal(integerOption(2.5, 'max_sms_per_hour'), 20, 'a decimal is refused');
  assert.equal(integerOption('2.5', 'max_parts'), 3);
  assert.equal(integerOption('abc', 'max_parts'), 3);
  assert.equal(integerOption(NaN, 'max_parts'), 3);
  assert.equal(integerOption(11, 'max_parts'), 10);
});

test('key and sender checks', () => {
  assert.ok(validKey('HCfnKCEcZygBmDS76IhOOhxhhuqV9g7g'));
  for (const bad of [
    'short',
    'with space key',
    'line\nbreak-key',
    'accentué-key-1234',
    'x'.repeat(201),
    42,
  ]) {
    assert.equal(validKey(bad), false, JSON.stringify(bad));
  }
  assert.ok(validSender('MaMaison'));
  assert.ok(validSender('Gladys2'));
  for (const bad of ['Ab', 'Ma Maison', 'TooLongSender', '0612345678', 'Café', 42]) {
    assert.equal(validSender(bad), false, JSON.stringify(bad));
  }
});

test('normalizeConfig: issues by code, never the value', () => {
  const ok = normalizeConfig({
    api_key: '  HCfnKCEcZygBmDS76IhOOhxhhuqV9g7g ',
    default_recipients: '0612345678',
    max_sms_per_hour: '10',
    stop_mention: 'true',
    accents: 'simplify',
  });
  assert.deepEqual(ok, {
    apiKey: 'HCfnKCEcZygBmDS76IhOOhxhhuqV9g7g',
    sender: '',
    stop: true,
    recipients: ['33612345678'],
    maxPerHour: 10,
    maxParts: 3,
    accents: 'simplify',
    issues: [],
  });
  const bad = normalizeConfig({
    api_key: 'bad key!',
    sender: 'x',
    default_recipients: '0123456789',
    accents: 'loud',
  });
  assert.deepEqual(bad.issues, ['bad_key', 'bad_sender', 'bad_recipients']);
  assert.equal(bad.apiKey, '');
  assert.equal(bad.accents, 'keep');
  assert.deepEqual(normalizeConfig().issues, ['no_key']);
  assert.equal(normalizeConfig({ stop_mention: 'yes' }).stop, false);
});
