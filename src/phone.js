// -----------------------------------------------------------------------------
// Phone numbers: the user types them the French way ("06 12 34 56 78",
// "+33 6 12 34 56 78", "0033 6...", "0692 ..." for La Réunion); smsmode wants
// E.164 digits without the "+" ("33612345678"). Pure.
//
// Accepted: French mobiles (06 and 07, metropolitan and overseas) and any
// international number written with + or 00 (8 to 15 digits). Refused: French
// landlines and special numbers (they receive no SMS), short codes, letters.
// A number is never written whole in a log or a message: `mask()`.
// -----------------------------------------------------------------------------

import { MAX_RECIPIENTS } from './constants.js';

/** National overseas mobile prefixes -> country calling code (ARCEP plan). */
const OVERSEAS = [
  ['0639', '262'], // Mayotte
  ['0692', '262'], // La Réunion
  ['0693', '262'],
  ['0690', '590'], // Guadeloupe, Saint-Martin, Saint-Barthélemy
  ['0691', '590'],
  ['0694', '594'], // Guyane
  ['0696', '596'], // Martinique
  ['0697', '596'],
];

export class PhoneError extends Error {
  constructor(code, masked) {
    super(code);
    this.name = 'PhoneError';
    this.code = code; // 'invalid', 'landline', 'too_many', 'none'
    this.masked = masked;
  }
}

/** "336******78": the first 3 digits and the last 2, never more. */
export function mask(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (digits.length < 7) return '***';
  return `${digits.slice(0, 3)}${'*'.repeat(digits.length - 5)}${digits.slice(-2)}`;
}

/** One number typed by the user -> E.164 digits, or a PhoneError. */
export function normalizePhone(raw) {
  if (typeof raw !== 'string') throw new PhoneError('invalid', '***');
  const compact = raw.replace(/[\s.\-()/\u00a0]/g, '');
  const masked = mask(compact);
  if (compact.length > 20 || !/^\+?\d+$/.test(compact)) throw new PhoneError('invalid', masked);
  let digits;
  if (/^0\d{9}$/.test(compact)) {
    const overseas = OVERSEAS.find(([prefix]) => compact.startsWith(prefix));
    // Overseas mobiles first (they start with 06 too); any other number is
    // metropolitan, and the check below keeps only its mobiles.
    digits = overseas ? overseas[1] + compact.slice(1) : `33${compact.slice(1)}`;
  } else if (/^\+\d{8,15}$/.test(compact)) {
    digits = compact.slice(1);
  } else if (/^00\d{8,15}$/.test(compact)) {
    digits = compact.slice(2);
  } else if (/^33[67]\d{8}$/.test(compact)) {
    // The smsmode format itself ("33612345678").
    digits = compact;
  } else {
    throw new PhoneError('invalid', masked);
  }
  if (digits.startsWith('0')) throw new PhoneError('invalid', masked);
  // A French number written internationally: a mobile (6 or 7) or nothing.
  if (/^33/.test(digits) && !/^33[67]\d{8}$/.test(digits)) {
    throw new PhoneError(digits.length === 11 ? 'landline' : 'invalid', masked);
  }
  return digits;
}

/** A list typed by the user (commas, semicolons, new lines) -> unique E.164 numbers. */
export function parseRecipients(raw) {
  if (raw === undefined || raw === null) return [];
  if (typeof raw !== 'string') throw new PhoneError('invalid', '***');
  const parts = raw
    .split(/[,;\n\r]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length > MAX_RECIPIENTS * 4) throw new PhoneError('too_many', '');
  const numbers = [];
  for (const part of parts) {
    const number = normalizePhone(part);
    if (!numbers.includes(number)) numbers.push(number);
  }
  if (numbers.length > MAX_RECIPIENTS) throw new PhoneError('too_many', '');
  return numbers;
}
