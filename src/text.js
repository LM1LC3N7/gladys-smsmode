// -----------------------------------------------------------------------------
// The SMS text: cleaned, encoded and counted the way operators bill it. Pure.
//
// GSM 7-bit (GSM 03.38 alphabet): 160 characters in one SMS, 153 per part when
// split; the extension characters (€ [ ] { } ^ ~ | \ and form feed) count
// twice. Anything else (ê, ç, emoji…) makes the whole text UNICODE: 70
// characters in one SMS, 67 per part, an emoji counting two. smsmode takes at
// most 1530 GSM characters or 670 UNICODE ones (10 parts).
//
// Optional "simplify": the French letters outside the GSM alphabet (ê, ç, ô,
// œ…) and the typographic signs (’ « » – …) are replaced by their closest GSM
// character, so a French text stays in 160-character SMS.
// -----------------------------------------------------------------------------

const GSM_BASIC = new Set(
  '@£$¥èéùìòÇ\nØø\r\u00c5åΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡' +
    'ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà',
);
const GSM_EXTENSION = new Set('\f^{}\\[~]|€');

const SIMPLE = {
  â: 'a',
  á: 'a',
  ã: 'a',
  À: 'A',
  '\u00c2': 'A',
  Á: 'A',
  ê: 'e',
  ë: 'e',
  È: 'E',
  Ê: 'E',
  Ë: 'E',
  î: 'i',
  ï: 'i',
  í: 'i',
  Î: 'I',
  Ï: 'I',
  ô: 'o',
  ó: 'o',
  õ: 'o',
  Ô: 'O',
  û: 'u',
  ú: 'u',
  Û: 'U',
  Ù: 'U',
  ç: 'c',
  œ: 'oe',
  Œ: 'OE',
  ÿ: 'y',
  '’': "'",
  '‘': "'",
  '‚': "'",
  '′': "'",
  '“': '"',
  '”': '"',
  '„': '"',
  '«': '"',
  '»': '"',
  '–': '-',
  '—': '-',
  '−': '-',
  '•': '-',
  '…': '...',
  '\u00a0': ' ',
  '\u202f': ' ',
  '\u2009': ' ',
};

export const LIMITS = {
  GSM7: { single: 160, part: 153, max: 1530 },
  UNICODE: { single: 70, part: 67, max: 670 },
};

/** The longest text accepted from a scene before cleaning (a guard, not a limit of SMS). */
export const MAX_INPUT = 10_000;

/** Cost of one character: 1 or 2 GSM septets, or undefined outside the GSM alphabet. */
function gsmCost(ch) {
  if (GSM_BASIC.has(ch)) return 1;
  if (GSM_EXTENSION.has(ch)) return 2;
  return undefined;
}

// Control characters (line feed apart) and invisible or direction-changing ones.
/* eslint-disable no-control-regex */
const INVISIBLE =
  /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2064\ufeff]/g;
/* eslint-enable no-control-regex */

/** Line breaks kept, tabs as spaces, every other control character removed, trimmed. */
export function cleanText(raw) {
  if (typeof raw !== 'string') return '';
  return raw
    .slice(0, MAX_INPUT)
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, ' ')
    .replace(INVISIBLE, '')
    .trim();
}

export function simplify(text) {
  let out = '';
  for (const ch of text) out += gsmCost(ch) ? ch : (SIMPLE[ch] ?? ch);
  return out;
}

/** 'GSM7' when every character is in the GSM alphabet, else 'UNICODE'. */
export function encodingOf(text) {
  for (const ch of text) if (!gsmCost(ch)) return 'UNICODE';
  return 'GSM7';
}

/** Length in the unit the operator counts: septets (GSM7) or UTF-16 units (UNICODE). */
export function unitsOf(text, encoding = encodingOf(text)) {
  if (encoding === 'UNICODE') return text.length;
  let n = 0;
  for (const ch of text) n += gsmCost(ch);
  return n;
}

/** The number of SMS the text is billed as, `reserve` units appended by smsmode included. */
export function partsOf(text, encoding = encodingOf(text), reserve = 0) {
  const units = unitsOf(text, encoding) + reserve;
  const limit = LIMITS[encoding];
  if (units <= limit.single) return 1;
  return Math.ceil(units / limit.part);
}

/** The room of `maxParts` SMS (never above what smsmode takes). */
export function capacity(encoding, maxParts) {
  const limit = LIMITS[encoding];
  return Math.min(limit.max, maxParts <= 1 ? limit.single : limit.part * maxParts);
}

/**
 * The text ready to send: cleaned, simplified when asked, cut to `maxParts`
 * SMS with "..." at the end, `reserve` units kept for what smsmode appends. `{ text, encoding, parts, truncated }`, or
 * `{ text: '' }` when nothing is left.
 */
export function prepareText(raw, { maxParts, accents = 'keep', reserve = 0 }) {
  let text = cleanText(raw);
  if (accents === 'simplify') text = simplify(text);
  if (!text) return { text: '', encoding: 'GSM7', parts: 0, truncated: false };
  const encoding = encodingOf(text);
  // The mention smsmode appends (STOP) takes its room in the last SMS.
  const room = capacity(encoding, maxParts) - reserve;
  let truncated = false;
  if (unitsOf(text, encoding) > room) {
    truncated = true;
    const keep = room - 3; // "..." costs 3 in both encodings
    let used = 0;
    let cut = '';
    for (const ch of text) {
      const cost = encoding === 'UNICODE' ? ch.length : gsmCost(ch);
      if (used + cost > keep) break;
      used += cost;
      cut += ch;
    }
    text = `${cut.trimEnd()}...`;
  }
  return { text, encoding, parts: partsOf(text, encoding, reserve), truncated };
}
