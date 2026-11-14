import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PhoneError, mask, normalizePhone, parseRecipients } from '../src/phone.js';

test('French numbers become E.164 digits; overseas mobiles get their own code', () => {
  for (const [input, expected] of [
    ['06 12 34 56 78', '33612345678'],
    ['07.98.76.54.32', '33798765432'],
    ['+33 6 12 34 56 78', '33612345678'],
    ['0033612345678', '33612345678'],
    ['33612345678', '33612345678'],
    ['(06) 12-34-56-78', '33612345678'],
    ['0692 12 34 56', '262692123456'],
    ['0639 12 34 56', '262639123456'],
    ['0690 12 34 56', '590690123456'],
    ['0694 12 34 56', '594694123456'],
    ['0696 12 34 56', '596696123456'],
    ['+32 470 12 34 56', '32470123456'],
    ['0044 7700 900123', '447700900123'],
  ]) {
    assert.equal(normalizePhone(input), expected, input);
  }
});

test('landlines, short codes, letters and odd forms are refused, with a masked number', () => {
  for (const [input, code] of [
    ['01 23 45 67 89', 'landline'],
    ['08 99 12 34 56', 'landline'],
    ['+33 1 23 45 67 89', 'landline'],
    ['+33 6 12 34 56', 'invalid'],
    ['36034', 'invalid'],
    ['06 12 34 56 7a', 'invalid'],
    ['+0612345678', 'invalid'],
    ['612345678', 'invalid'],
    ['06123456789', 'invalid'],
    ['+1234567', 'invalid'],
    ['+1234567890123456', 'invalid'],
    ['06 12 34 56 78 ext', 'invalid'],
    ['', 'invalid'],
  ]) {
    assert.throws(
      () => normalizePhone(input),
      (err) => err instanceof PhoneError && err.code === code && !err.message.includes('1234'),
      input,
    );
  }
  assert.throws(() => normalizePhone(42), PhoneError);
});

test('mask keeps 3 digits and the last 2', () => {
  assert.equal(mask('33612345678'), '336******78');
  assert.equal(mask('+33 6 12 34 56 78'), '336******78');
  assert.equal(mask('123'), '***');
  assert.equal(mask(undefined), '***');
});

test('a list: separators, duplicates, at most 5', () => {
  assert.deepEqual(parseRecipients('0612345678; 07 98 76 54 32,\n+33612345678'), [
    '33612345678',
    '33798765432',
  ]);
  assert.deepEqual(parseRecipients(''), []);
  assert.deepEqual(parseRecipients(undefined), []);
  assert.deepEqual(parseRecipients(' , ; '), []);
  const six = ['0612345670', '0612345671', '0612345672', '0612345673', '0612345674', '0612345675'];
  assert.equal(parseRecipients(six.slice(0, 5).join(',')).length, 5);
  assert.throws(() => parseRecipients(six.join(',')), { code: 'too_many' });
  assert.throws(() => parseRecipients(Array(30).fill('0612345678').join(',')), {
    code: 'too_many',
  });
  assert.throws(() => parseRecipients(['0612345678']), PhoneError);
});
