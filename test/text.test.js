import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_INPUT,
  capacity,
  cleanText,
  encodingOf,
  partsOf,
  prepareText,
  simplify,
  unitsOf,
} from '../src/text.js';

test('GSM 7-bit or UNICODE, counted as operators bill it', () => {
  assert.equal(encodingOf('Bonjour à tous, été réussi : 12 € !'), 'GSM7');
  assert.equal(encodingOf('Fenêtre'), 'UNICODE');
  assert.equal(encodingOf('ça'), 'UNICODE', 'only the capital Ç is in the alphabet');
  assert.equal(encodingOf('l’entrée'), 'UNICODE');
  assert.equal(encodingOf('🔥'), 'UNICODE');
  assert.equal(unitsOf('a€[]'), 7, 'extension characters count 2');
  assert.equal(unitsOf('🔥a'), 3, 'an emoji counts 2 UTF-16 units');
  assert.equal(partsOf('a'.repeat(160)), 1);
  assert.equal(partsOf('a'.repeat(161)), 2);
  assert.equal(partsOf('a'.repeat(306)), 2);
  assert.equal(partsOf('a'.repeat(307)), 3);
  assert.equal(partsOf('€'.repeat(80)), 1);
  assert.equal(partsOf('€'.repeat(81)), 2);
  assert.equal(partsOf('ê'.repeat(70)), 1);
  assert.equal(partsOf('ê'.repeat(71)), 2);
  assert.equal(partsOf('ê'.repeat(134)), 2);
  assert.equal(partsOf('ê'.repeat(135)), 3);
  assert.equal(capacity('GSM7', 1), 160);
  assert.equal(capacity('GSM7', 10), 1530);
  assert.equal(capacity('UNICODE', 10), 670);
  assert.equal(capacity('UNICODE', 3), 201);
});

test('cleaning: line breaks kept, controls and invisible characters removed', () => {
  assert.equal(cleanText('  a\r\nb\rc\td\u0007e\u200bf\ufeff  '), 'a\nb\nc def');
  assert.equal(cleanText('x\u2028y\u202ez'), 'xyz');
  assert.equal(cleanText(undefined), '');
  assert.equal(cleanText(42), '');
  assert.equal(cleanText('a'.repeat(MAX_INPUT + 50)).length, MAX_INPUT);
});

test('simplify: French letters and typography to their GSM neighbours', () => {
  assert.equal(
    simplify('Fenêtre, garçon, cœur, Noël, île, côte, où'),
    'Fenetre, garcon, coeur, Noel, ile, cote, où',
  );
  assert.equal(simplify('« l’été » – 3 °C…'), '" l\'été " - 3 °C...');
  assert.equal(simplify('a\u00a0b\u202fc'), 'a b c');
  assert.equal(encodingOf(simplify('Fenêtre ouverte à l’étage, chaîne coupée')), 'GSM7');
  assert.equal(simplify('🔥'), '🔥', 'no neighbour: kept (UNICODE)');
});

test('prepareText: cut to the maximum number of SMS, "..." at the end, emoji never split', () => {
  const long = prepareText('a'.repeat(400), { maxParts: 2 });
  assert.equal(long.truncated, true);
  assert.equal(long.text.length, 306);
  assert.equal(long.parts, 2);
  assert.ok(long.text.endsWith('...'));
  const one = prepareText('b'.repeat(200), { maxParts: 1 });
  assert.equal(one.text.length, 160);
  assert.equal(one.parts, 1);
  const euro = prepareText('€'.repeat(100), { maxParts: 1 });
  assert.equal(unitsOf(euro.text), 159);
  const emoji = prepareText('🔥'.repeat(50), { maxParts: 1 });
  assert.equal(emoji.encoding, 'UNICODE');
  assert.ok(emoji.text.length <= 70);
  assert.ok(!/[\ud800-\udbff]\.\.\.$/.test(emoji.text), 'no lone surrogate before the dots');
  const big = prepareText('ê'.repeat(5000), { maxParts: 10 });
  assert.equal(big.text.length, 670);
  assert.equal(big.parts, 10);
  const short = prepareText('Fenêtre ouverte', { maxParts: 3, accents: 'simplify' });
  assert.deepEqual(short, {
    text: 'Fenetre ouverte',
    encoding: 'GSM7',
    parts: 1,
    truncated: false,
  });
  assert.deepEqual(prepareText(' \n\t ', { maxParts: 3 }).text, '');
  const spaces = prepareText(`${'a'.repeat(155)}      bbbbbb`, { maxParts: 1 });
  assert.equal(spaces.text, `${'a'.repeat(155)}...`);
});
