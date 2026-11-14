// -----------------------------------------------------------------------------
// Keys of the manifest, bounds and delays. The manifest keys are forever: a
// renamed key is a removed key for every scene and configuration using it.
// -----------------------------------------------------------------------------

export const VERSION = '0.1.0';
export const USER_AGENT = `gladys-smsmode/${VERSION} (+https://github.com/LM1LC3N7/gladys-smsmode)`;

/** The smsmode REST API (https://dev.smsmode.com/sms/v1/, read on 2026-11-14). */
export const API_BASE = 'https://rest.smsmode.com';
export const SEND_PATH = '/sms/v1/messages';
/** Organisations list: the organisation of the key, with its balance (Commons API v1). */
export const ACCOUNT_PATH = '/commons/v1/organisations?page=1&pageSize=1';

export const CONFIG = {
  API_KEY: 'api_key',
  SENDER: 'sender',
  STOP: 'stop_mention',
  RECIPIENTS: 'default_recipients',
  MAX_PER_HOUR: 'max_sms_per_hour',
  MAX_PARTS: 'max_parts',
  ACCENTS: 'accents',
};

export const ACTIONS = { CHECK: 'check_account', TEST: 'send_test' };
export const SCENE_ACTION = 'send_sms';

/** Defaults, mirrored by the manifest (test/manifest.test.js ties them). */
export const DEFAULTS = {
  [CONFIG.MAX_PER_HOUR]: 20,
  [CONFIG.MAX_PARTS]: 3,
  [CONFIG.ACCENTS]: 'keep',
  [CONFIG.STOP]: false,
};
/** Integer bounds [min, max] of the numeric options. */
export const BOUNDS = {
  [CONFIG.MAX_PER_HOUR]: [1, 200],
  [CONFIG.MAX_PARTS]: [1, 10],
};
export const ACCENT_MODES = ['keep', 'simplify'];

/** At most this many recipients per message (and in the default list). */
export const MAX_RECIPIENTS = 5;
/** The window of the hourly cap, in ms. */
export const CAP_WINDOW = 60 * 60_000;

/** One request, from the first byte to the last byte of the answer. */
export const HTTP_TIMEOUT = 10_000;
/** The answers read are small: anything larger is cut. */
export const MAX_ANSWER_BYTES = 64 * 1024;
/** Scene action budget: under the manifest's timeout_seconds (60 s). */
export const SCENE_BUDGET = 55_000;
/** Test button budget: under the manifest's timeout_seconds (30 s). */
export const BUTTON_BUDGET = 25_000;
/** Scene actions waiting for their turn (one request in flight at a time). */
export const MAX_QUEUE = 20;

/** Pause after a 429 or a 5xx: Retry-After when given, bounded, growing on repeat. */
export const PAUSE_MIN = 60_000;
export const PAUSE_MAX = 6 * 60 * 60_000;

/** /data: read again every 10 s while unreadable; a save never waits longer than this. */
export const STORE_RETRY = 10_000;
export const SAVE_TIMEOUT = 3_000;
export const STATUS_TIMEOUT = 4_000;
export const MAX_STATE_BYTES = 64 * 1024;
/** Sends remembered for the cap (more is never needed: at most 200 per hour). */
export const MAX_SENDS_KEPT = 500;
