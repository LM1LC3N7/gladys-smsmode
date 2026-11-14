// -----------------------------------------------------------------------------
// The app against the SDK's fake Gladys, a scripted smsmode API and a virtual
// clock (each read moves it 1 µs).
// -----------------------------------------------------------------------------

import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { App } from '../../src/app.js';
import { ACTIONS, API_BASE, SCENE_ACTION } from '../../src/constants.js';
import { createMemoryStore } from '../../src/store.js';
import { testClock } from './clock.js';

export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
export const NOW = Date.parse('2026-11-14T09:00:00Z');
export const KEY = 'TestKey-0123456789abcdefSECRET';

export const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

let seq = 0;
export const accepted = (parts = 1) =>
  json(
    {
      messageId: `00000000-0000-4000-8000-${String((seq += 1)).padStart(12, '0')}`,
      acceptedAt: '2026-11-14T10:00:00',
      body: { messagePartCount: parts },
      status: { value: 'ENROUTE' },
    },
    201,
  );

/** A fetch failure like undici's: `code` on the cause, or a timeout. */
export function fetchError(kind) {
  if (kind === 'timeout') {
    const err = new Error('The operation was aborted due to timeout');
    err.name = 'TimeoutError';
    return err;
  }
  const err = new TypeError('fetch failed');
  err.cause = Object.assign(new Error(kind), { code: kind });
  return err;
}

/**
 * smsmode: `api.handler(request)` returns a Response, or a string naming a
 * failure ('timeout', 'ECONNRESET', 'ENOTFOUND'…); none = accepted.
 */
export function createApi() {
  const api = { requests: [], handler: undefined, inFlight: 0, peak: 0 };
  api.sends = () => api.requests.filter((r) => r.method === 'POST');
  api.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    const request = {
      url: String(url),
      path: `${u.pathname}${u.search}`,
      method: init.method,
      headers: init.headers ?? {},
      body: init.body ? JSON.parse(init.body) : undefined,
      init,
    };
    api.requests.push(request);
    api.inFlight += 1;
    api.peak = Math.max(api.peak, api.inFlight);
    try {
      if (u.origin !== API_BASE) return new Response('nope', { status: 404 });
      const out = api.handler ? await api.handler(request) : undefined;
      if (typeof out === 'string') throw fetchError(out);
      if (out instanceof Response) return out;
      if (request.method === 'POST') return accepted();
      return json({ items: [{ balance: { amount: 12.5, currency: 'EUR' } }] });
    } finally {
      api.inFlight -= 1;
    }
  };
  return api;
}

export const BASE_CONFIG = { api_key: KEY, default_recipients: '06 12 34 56 78' };

export async function setup({
  config = BASE_CONFIG,
  store = createMemoryStore(),
  now = NOW,
  start = true,
  handler,
  getConfig,
} = {}) {
  const gladys = createFakeGladys({ selector: 'smsmode', config });
  if (getConfig) gladys.getConfig = getConfig;
  const clock = testClock({ start: now });
  const api = createApi();
  api.handler = handler;
  const lines = [];
  const log = (...args) => lines.push(args.map(String).join(' '));
  let random = 0;
  const app = new App({
    gladys,
    logger: { info: log, warn: log, error: log, debug: log },
    now: clock.now,
    monotonic: clock.monotonic,
    timers: clock.timers,
    store,
    fetchImpl: api.fetch,
    random: (n) => String((random += 1)).padStart(n * 2, 'a'),
  });
  gladys.onSceneAction(SCENE_ACTION, (fields) => app.sceneSend(fields));
  gladys.onAction(ACTIONS.TEST, (fields) => app.testSend(fields));
  gladys.onAction(ACTIONS.CHECK, () => app.checkAccount());
  gladys.onConfigUpdated((c) => app.configUpdated(c));
  gladys.on('connected', () => app.connected());
  const wait = async (ms) => {
    await clock.advance(ms);
    await app.idle();
  };
  if (start) {
    await gladys.connect();
    await wait(0);
  }
  /** The scene action, as Gladys runs it: resolves the ack. */
  const scene = (fields) => gladys.fake.sceneAction(SCENE_ACTION, fields);
  return { app, gladys, clock, store, api, wait, lines, scene };
}

/** Everything the module wrote outside the API: logs, statuses, /data. */
export function leaked({ lines, gladys, store }) {
  return [
    ...lines,
    JSON.stringify(gladys.fake.connectionStatuses),
    JSON.stringify(store.data ?? {}),
  ].join('\n');
}
