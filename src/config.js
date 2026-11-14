// -----------------------------------------------------------------------------
// The configuration typed in Gladys, read strictly. An option out of its
// bounds is brought back inside them; an empty or unreadable one takes its
// default. The API key, the sender and the default numbers are checked here;
// what is wrong is said by a code (`issues`), never by echoing the value.
// -----------------------------------------------------------------------------

import { ACCENT_MODES, BOUNDS, CONFIG, DEFAULTS } from './constants.js';
import { PhoneError, parseRecipients } from './phone.js';

/** A strict integer option: '' or text = the default; a decimal refused; bounded. */
export function integerOption(raw, key) {
  const [min, max] = BOUNDS[key];
  let n;
  if (typeof raw === 'number') n = raw;
  else if (typeof raw === 'string' && /^\s*-?\d+\s*$/.test(raw)) n = Number(raw);
  if (!Number.isInteger(n)) return DEFAULTS[key];
  return Math.min(max, Math.max(min, n));
}

/** Printable ASCII only, 8 to 200 characters: a header value, never CR, LF or a control. */
export const validKey = (key) => typeof key === 'string' && /^[\x21-\x7e]{8,200}$/.test(key);

/** An alphanumeric sender: 3 to 11 letters or digits, at least one letter. */
export const validSender = (sender) =>
  typeof sender === 'string' && /^[A-Za-z0-9]{3,11}$/.test(sender) && /[A-Za-z]/.test(sender);

export function normalizeConfig(raw = {}) {
  const issues = [];
  const apiKey = typeof raw[CONFIG.API_KEY] === 'string' ? raw[CONFIG.API_KEY].trim() : '';
  if (!apiKey) issues.push('no_key');
  else if (!validKey(apiKey)) issues.push('bad_key');

  const sender = typeof raw[CONFIG.SENDER] === 'string' ? raw[CONFIG.SENDER].trim() : '';
  if (sender && !validSender(sender)) issues.push('bad_sender');

  let recipients = [];
  try {
    recipients = parseRecipients(raw[CONFIG.RECIPIENTS]);
  } catch (err) {
    if (!(err instanceof PhoneError)) throw err;
    issues.push('bad_recipients');
  }

  const stopRaw = raw[CONFIG.STOP];
  const accents = ACCENT_MODES.includes(raw[CONFIG.ACCENTS])
    ? raw[CONFIG.ACCENTS]
    : DEFAULTS[CONFIG.ACCENTS];
  return {
    apiKey: issues.includes('bad_key') ? '' : apiKey,
    sender: issues.includes('bad_sender') ? '' : sender,
    stop: stopRaw === true || stopRaw === 'true',
    recipients,
    maxPerHour: integerOption(raw[CONFIG.MAX_PER_HOUR], CONFIG.MAX_PER_HOUR),
    maxParts: integerOption(raw[CONFIG.MAX_PARTS], CONFIG.MAX_PARTS),
    accents,
    issues,
  };
}
