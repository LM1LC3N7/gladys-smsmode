// -----------------------------------------------------------------------------
// The real clock (performance.now, setTimeout) sped up, and a real local HTTP
// server standing for smsmode: the pause after a 5xx lasts 60 s, the hourly
// cap frees a slot 60 minutes after the send, never sooner; nothing leaves
// after stop. Wide margins: a timer is late under load, never early.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { App } from '../src/app.js';
import { API_BASE } from '../src/constants.js';
import { createMemoryStore } from '../src/store.js';
import { realClock } from './helpers/clock.js';

async function bench(t, { speed, status = () => 201, config }) {
  const clock = realClock({ speed });
  const requests = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      requests.push({ at: clock.monotonic(), ua: req.headers['user-agent'], body });
      const code = status(requests.length);
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify(code === 201 ? { messageId: 'x', body: { messagePartCount: 1 } } : {}),
      );
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const gladys = createFakeGladys({ selector: 'smsmode', config });
  const app = new App({
    gladys,
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    now: clock.now,
    monotonic: clock.monotonic,
    timers: clock.timers,
    store: createMemoryStore(),
    fetchImpl: (url, init) => fetch(String(url).replace(API_BASE, base), init),
  });
  gladys.on('connected', () => app.connected());
  t.after(async () => {
    await app.stop();
    clock.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  await gladys.connect();
  await app.idle();
  return { app, clock, requests };
}

/** Tries a send every `step` simulated ms until one is accepted; resolves its time. */
async function firstAccepted({ app, clock }, step, limit) {
  const start = clock.monotonic();
  while (clock.monotonic() - start < limit) {
    const at = clock.monotonic();
    const out = await app.send({ text: 'x', budget: 55_000 }).catch(() => undefined);
    if (out?.accepted) return at;
    await clock.sleep(step);
  }
  throw new Error('never accepted');
}

test('real clock: the pause after a 5xx lasts 60 s, never less', async (t) => {
  const b = await bench(t, {
    speed: 100,
    status: (n) => (n === 1 ? 503 : 201),
    config: { api_key: 'TestKey-0123456789', default_recipients: '0612345678' },
  });
  await b.app.send({ text: 'x', budget: 55_000 });
  const failedAt = b.requests[0].at;
  const at = await firstAccepted(b, 2_000, 200_000);
  const gap = at - failedAt;
  assert.ok(gap >= 60_000 && gap <= 90_000, `pause of ${Math.round(gap)} ms`);
  assert.equal(b.requests.length, 2, 'no request during the pause');
  assert.match(b.requests[0].ua, /^gladys-smsmode\//);
});

test('real clock: the hourly cap frees a slot 60 minutes after the send; nothing after stop', async (t) => {
  const b = await bench(t, {
    speed: 400,
    config: {
      api_key: 'TestKey-0123456789',
      default_recipients: '0612345678',
      max_sms_per_hour: 1,
    },
  });
  await b.app.send({ text: 'x', budget: 55_000 });
  const sentAt = b.requests[0].at;
  const at = await firstAccepted(b, 60_000, 3 * 60 * 60_000);
  const gap = at - sentAt;
  assert.ok(
    gap >= 60 * 60_000 && gap <= 90 * 60_000,
    `slot freed after ${Math.round(gap / 60_000)} min`,
  );
  assert.equal(b.requests.length, 2);
  await b.app.stop();
  const timers = b.clock.timersSet;
  await b.clock.sleep(2 * 60 * 60_000);
  assert.equal(b.requests.length, 2, 'no request after stop');
  assert.equal(b.clock.timersSet, timers, 'no timer after stop');
});
