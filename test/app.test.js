import { test } from 'node:test';
import assert from 'node:assert/strict';
import { App, keyMark } from '../src/app.js';
import { USER_AGENT } from '../src/constants.js';
import { createMemoryStore } from '../src/store.js';
import {
  BASE_CONFIG,
  HOUR,
  KEY,
  MINUTE,
  NOW,
  SECOND,
  accepted,
  json,
  leaked,
  setup,
} from './helpers/app.js';

const status = (gladys) => gladys.fake.connectionStatus;
const sendsOf = (store) => store.data?.sends ?? [];

test('nothing is sent at start, on a reconnection nor on a configuration change', async () => {
  const ctx = await setup();
  await ctx.gladys.fake.configUpdated({ ...BASE_CONFIG, max_sms_per_hour: 5 });
  await ctx.gladys.disconnect();
  await ctx.gladys.connect();
  await ctx.wait(2 * HOUR);
  assert.equal(ctx.api.requests.length, 0);
  assert.equal(status(ctx.gladys).connected, true);
  assert.match(status(ctx.gladys).message.fr, /5 SMS par heure/);
  await ctx.app.stop();
});

test('a scene sends to the default number, with the documented request', async () => {
  const ctx = await setup();
  const ack = await ctx.scene({ text: 'Alarme : intrusion au salon' });
  assert.equal(ack.success, true, ack.error);
  assert.equal(ack.data.outputs.sent, 1);
  assert.equal(ack.data.outputs.not_sent, 0);
  assert.equal(ack.data.outputs.truncated, false);
  assert.match(ack.data.outputs.message_ids, /^[0-9a-f-]{36}$/);
  const [r] = ctx.api.requests;
  assert.equal(r.url, 'https://rest.smsmode.com/sms/v1/messages');
  assert.equal(r.method, 'POST');
  assert.equal(r.headers['X-Api-Key'], KEY);
  assert.equal(r.headers.Accept, 'application/json');
  assert.equal(r.headers['Content-Type'], 'application/json');
  assert.equal(r.headers['User-Agent'], USER_AGENT);
  assert.equal(r.init.redirect, 'manual');
  assert.ok(r.init.signal, 'a timeout');
  assert.deepEqual(r.body, {
    recipient: { to: '33612345678' },
    body: { text: 'Alarme : intrusion au salon', encoding: 'GSM7' },
  });
  await ctx.app.stop();
});

test('the numbers of the action replace the default ones; sender and STOP when set', async () => {
  const ctx = await setup({
    config: { ...BASE_CONFIG, sender: 'MaMaison', stop_mention: true },
  });
  const ack = await ctx.scene({
    text: 'Fenêtre ouverte',
    recipients: '07 98 76 54 32; +262 692 12 34 56, 0798765432',
  });
  assert.equal(ack.success, true, ack.error);
  assert.equal(ack.data.outputs.sent, 2, 'duplicates sent once');
  assert.deepEqual(
    ctx.api.sends().map((r) => r.body.recipient.to),
    ['33798765432', '262692123456'],
  );
  const body = ctx.api.sends()[0].body;
  assert.equal(body.from, 'MaMaison');
  assert.equal(body.body.stop, true);
  assert.equal(body.body.encoding, 'UNICODE', 'ê is outside the GSM alphabet');
  await ctx.app.stop();
});

test('accents simplified on demand: the text stays GSM 7-bit', async () => {
  const ctx = await setup({ config: { ...BASE_CONFIG, accents: 'simplify' } });
  await ctx.scene({ text: 'Fenêtre de l’entrée « ouverte » – Noël' });
  const body = ctx.api.sends()[0].body.body;
  assert.equal(body.text, 'Fenetre de l\'entrée " ouverte " - Noel');
  assert.equal(body.encoding, 'GSM7');
  await ctx.app.stop();
});

test('a text too long is cut to the maximum number of SMS, and said', async () => {
  const ctx = await setup({ config: { ...BASE_CONFIG, max_parts: 2 } });
  const ack = await ctx.scene({ text: 'a'.repeat(1000) });
  assert.equal(ack.data.outputs.truncated, true);
  const text = ctx.api.sends()[0].body.body.text;
  assert.equal(text.length, 306);
  assert.ok(text.endsWith('...'));
  await ctx.app.stop();
});

test('refused before any request: no key, bad sender, bad numbers, landline, empty text', async () => {
  for (const [config, fields, pattern] of [
    [{ default_recipients: '0612345678' }, { text: 'x' }, /pas de clé/],
    [{ ...BASE_CONFIG, api_key: 'clé avec espace' }, { text: 'x' }, /clé d'API est illisible/],
    [{ ...BASE_CONFIG, sender: 'Ma Maison!' }, { text: 'x' }, /émetteur/],
    [BASE_CONFIG, { text: 'x', recipients: '0612' }, /numéro est illisible/],
    [BASE_CONFIG, { text: 'x', recipients: '01 23 45 67 89' }, /fixe/],
    [
      BASE_CONFIG,
      {
        text: 'x',
        recipients: '0612345678,0712345678,0612345671,0612345672,0612345673,0612345674',
      },
      /5 au plus/,
    ],
    [{ api_key: KEY }, { text: 'x' }, /aucun destinataire/],
    [{ api_key: KEY, default_recipients: '0412345678' }, { text: 'x' }, /numéro est illisible/],
    [BASE_CONFIG, { text: ' \u0007 \n ' }, /texte est vide/],
  ]) {
    const ctx = await setup({ config });
    const ack = await ctx.scene(fields);
    assert.equal(ack.success, false, JSON.stringify(fields));
    assert.match(ack.error, pattern);
    assert.match(ack.error, /^Rien envoyé/);
    assert.doesNotMatch(ack.error, /0612|0123|0412/, 'a number is never echoed');
    assert.equal(ctx.api.requests.length, 0);
    await ctx.app.stop();
  }
});

test('the hourly cap counts billed parts over 60 minutes, then frees them', async () => {
  const ctx = await setup({ config: { ...BASE_CONFIG, max_sms_per_hour: 5 } });
  assert.equal((await ctx.scene({ text: 'un' })).success, true);
  await ctx.wait(10 * MINUTE);
  // 200 GSM characters: 2 SMS.
  assert.equal((await ctx.scene({ text: 'b'.repeat(200) })).data.outputs.sent, 1);
  assert.equal((await ctx.scene({ text: 'trois' })).success, true);
  const refused = await ctx.scene({ text: 'quatre, mais deux SMS'.padEnd(170, '.') });
  assert.equal(refused.success, false);
  assert.match(refused.error, /plafond horaire/);
  assert.equal((await ctx.scene({ text: 'quatre' })).success, true, 'one part still fits');
  assert.equal((await ctx.scene({ text: 'cinq' })).success, false);
  assert.equal(ctx.api.sends().length, 4);
  // The first SMS leaves the window 60 minutes after it was sent.
  await ctx.wait(50 * MINUTE - SECOND);
  assert.equal((await ctx.scene({ text: 'cinq' })).success, false, 'not one second early');
  await ctx.wait(2 * SECOND);
  assert.equal((await ctx.scene({ text: 'cinq' })).success, true);
  await ctx.app.stop();
});

test('the cap counts what smsmode billed when it says more parts', async () => {
  const ctx = await setup({
    config: { ...BASE_CONFIG, max_sms_per_hour: 3 },
    handler: () => accepted(3),
  });
  assert.equal((await ctx.scene({ text: 'court' })).success, true);
  const ack = await ctx.scene({ text: 'encore' });
  assert.equal(ack.success, false);
  assert.match(ack.error, /plafond/);
  await ctx.app.stop();
});

test('the cap survives a restart through /data; a future date counts as now', async () => {
  const store = createMemoryStore({
    sends: [
      { wall: NOW - 2 * HOUR, parts: 5 },
      { wall: NOW - 30 * MINUTE, parts: 1 },
      { wall: NOW + 10 * HOUR, parts: 1 },
      { wall: 'x', parts: 1 },
      { wall: NOW - MINUTE, parts: 99 },
    ],
  });
  const ctx = await setup({ store, config: { ...BASE_CONFIG, max_sms_per_hour: 3 } });
  assert.equal((await ctx.scene({ text: 'a' })).success, true);
  assert.equal((await ctx.scene({ text: 'b' })).success, false, '2 kept + 1 = 3');
  // The SMS of 30 minutes ago leaves the window 30 minutes later.
  await ctx.wait(31 * MINUTE);
  assert.equal((await ctx.scene({ text: 'c' })).success, true);
  assert.ok(sendsOf(store).every((s) => s.wall <= ctx.clock.now()));
  await ctx.app.stop();
});

test('a send that may have left is never tried again (timeout, cut, 5xx), and stays counted', async () => {
  for (const failure of ['timeout', 'ECONNRESET', 500]) {
    const ctx = await setup({
      config: { ...BASE_CONFIG, max_sms_per_hour: 2 },
      handler: () => (typeof failure === 'number' ? json({}, failure) : failure),
    });
    const ack = await ctx.scene({ text: 'x', recipients: '0612345678, 0712345678' });
    assert.equal(ack.success, false);
    assert.match(ack.error, /sans confirmation/);
    assert.match(ack.error, /pas de nouvel essai/);
    assert.equal(
      ctx.api.sends().length,
      1,
      `${failure}: one request, the second recipient left alone`,
    );
    assert.equal(sendsOf(ctx.store).length, 1, `${failure}: counted in the cap`);
    ctx.api.handler = undefined;
    await ctx.wait(7 * HOUR);
    assert.equal(ctx.api.sends().length, 1, `${failure}: never sent again by itself`);
    await ctx.app.stop();
  }
});

test('a send that surely did not leave gives its slot back', async () => {
  for (const failure of ['ENOTFOUND', 'ECONNREFUSED', 'CERT_HAS_EXPIRED']) {
    const ctx = await setup({
      config: { ...BASE_CONFIG, max_sms_per_hour: 1 },
      handler: () => failure,
    });
    const ack = await ctx.scene({ text: 'x' });
    assert.equal(ack.success, false);
    assert.match(ack.error, /non envoyé/);
    assert.doesNotMatch(ack.error, /sans confirmation/);
    ctx.api.handler = undefined;
    assert.equal((await ctx.scene({ text: 'y' })).success, true, `${failure}: the slot is free`);
    await ctx.app.stop();
  }
});

test('a 400 on one number does not stop the next one; a redirect sends nothing', async () => {
  const ctx = await setup({
    handler: (r) =>
      r.body.recipient.to === '33612345678'
        ? json({ errorCode: 'RECIPIENT_TO_INVALID', message: 'bad 33612345678' }, 400)
        : undefined,
  });
  const ack = await ctx.scene({ text: 'x', recipients: '0612345678, 0712345678' });
  assert.equal(ack.success, true);
  assert.equal(ack.data.outputs.sent, 1);
  assert.equal(ack.data.outputs.not_sent, 1);
  assert.doesNotMatch(leaked(ctx), /33612345678|0612345678/);
  ctx.api.handler = () => new Response(null, { status: 302, headers: { location: 'https://x' } });
  const redirected = await ctx.scene({ text: 'x' });
  assert.equal(redirected.success, false);
  assert.match(redirected.error, /redirection/);
  await ctx.app.stop();
});

test('5xx: a pause of 60 s, doubled on repeat, kept in /data across a restart', async () => {
  const store = createMemoryStore();
  const ctx = await setup({ store, handler: () => json({}, 503) });
  await ctx.scene({ text: 'x' });
  assert.equal(status(ctx.gladys).connected, false);
  assert.match(status(ctx.gladys).message.fr, /en panne \(5xx\).*avant 10:01/);
  const paused = await ctx.scene({ text: 'x' });
  assert.match(paused.error, /pause/);
  assert.equal(ctx.api.sends().length, 1);
  await ctx.wait(61 * SECOND);
  assert.equal(status(ctx.gladys).connected, true, 'the status says when the pause ends');
  await ctx.scene({ text: 'x' });
  assert.equal(ctx.api.sends().length, 2);
  assert.equal(store.data.pause.streak, 2);
  // A restart 70 s later: still paused (120 s), without a request.
  await ctx.app.stop();
  const again = await setup({ store, now: ctx.clock.now() + 70 * SECOND });
  assert.match((await again.scene({ text: 'x' })).error, /pause/, 'the second pause is 120 s');
  assert.equal(again.api.requests.length, 0);
  await again.wait(51 * SECOND);
  assert.equal((await again.scene({ text: 'x' })).success, true);
  assert.equal(again.store.data.pause.streak, 0, 'a success resets the growth');
  await again.app.stop();
});

test('429: Retry-After followed within 60 s .. 6 h', async () => {
  for (const [header, expected] of [
    ['120', 120 * SECOND],
    ['1', 60 * SECOND],
    ['999999', 6 * HOUR],
    [undefined, 60 * SECOND],
  ]) {
    const ctx = await setup({
      handler: () => json({}, 429, header ? { 'retry-after': header } : {}),
    });
    await ctx.scene({ text: 'x' });
    ctx.api.handler = undefined;
    await ctx.wait(expected - SECOND);
    assert.match((await ctx.scene({ text: 'x' })).error, /pause/, `${header}: still paused`);
    await ctx.wait(2 * SECOND);
    assert.equal((await ctx.scene({ text: 'x' })).success, true, `${header}: resumed`);
    await ctx.app.stop();
  }
});

test('401 on a send: the key is never sent again by a scene; a new key or a button lifts it', async () => {
  const store = createMemoryStore();
  const ctx = await setup({ store, handler: () => json({ status: 401 }, 401) });
  const ack = await ctx.scene({ text: 'x', recipients: '0612345678, 0712345678' });
  assert.match(ack.error, /refusée \(401\)/);
  assert.equal(ctx.api.sends().length, 1, 'the second recipient is not tried');
  assert.equal(status(ctx.gladys).connected, false);
  assert.match(status(ctx.gladys).message.fr, /refusé la clé/);
  assert.match(store.data.refused, /^[0-9a-f]{2}$/);
  ctx.api.handler = undefined;
  assert.match((await ctx.scene({ text: 'x' })).error, /refusée/);
  assert.equal(ctx.api.sends().length, 1);
  // A restart remembers it.
  await ctx.app.stop();
  const again = await setup({ store });
  assert.match((await again.scene({ text: 'x' })).error, /refusée/);
  assert.equal(again.api.requests.length, 0);
  // The check button's success lifts it.
  const check = await again.gladys.fake.action('check_account', {});
  assert.match(check.data.message.fr, /accepté la clé\. Solde : 12\.50 EUR/);
  assert.equal(store.data.refused, null);
  assert.equal((await again.scene({ text: 'x' })).success, true);
  await again.app.stop();
});

test('a key changed during the run is always tried, even if its mark matches the refused one', async () => {
  const store = createMemoryStore();
  const ctx = await setup({ store, handler: () => json({}, 401) });
  await ctx.scene({ text: 'x' });
  assert.match(store.data.refused, /^[0-9a-f]{2}$/);
  ctx.api.handler = undefined;
  // Find a new key whose 8-bit mark collides with the refused one.
  let other;
  for (let i = 0; !other; i += 1) {
    if (keyMark(store.data.salt, `${KEY}-${i}`) === store.data.refused) other = `${KEY}-${i}`;
  }
  await ctx.gladys.fake.configUpdated({ ...BASE_CONFIG, api_key: other });
  assert.equal((await ctx.scene({ text: 'x' })).success, true);
  assert.equal(store.data.refused, null);
  assert.equal(status(ctx.gladys).connected, true);
  // The same key saved again (no change) keeps a refusal.
  ctx.api.handler = () => json({}, 401);
  await ctx.scene({ text: 'x' });
  await ctx.gladys.fake.configUpdated({ ...BASE_CONFIG, api_key: other });
  ctx.api.handler = undefined;
  assert.match((await ctx.scene({ text: 'x' })).error, /refusée/);
  await ctx.app.stop();
});

test('the test button tries a refused key again, and its success lifts the refusal', async () => {
  const ctx = await setup({ handler: () => json({}, 401) });
  await ctx.scene({ text: 'x' });
  ctx.api.handler = undefined;
  const ack = await ctx.gladys.fake.action('send_test', { phone: '07 11 22 33 44' });
  assert.match(ack.data.message.fr, /1 SMS accepté/);
  assert.equal(ctx.api.sends().at(-1).body.recipient.to, '33711223344');
  assert.equal(ctx.api.sends().at(-1).body.body.text, 'Gladys : SMS de test du module smsmode.');
  assert.equal((await ctx.scene({ text: 'x' })).success, true);
  const bad = await ctx.gladys.fake.action('send_test', { phone: '01 11 22 33 44' });
  assert.match(bad.data.message.fr, /fixe/);
  assert.doesNotMatch(JSON.stringify(bad), /0111/);
  await ctx.app.stop();
});

test('check button: neither 403 nor 401 is a refusal for sending, a 5xx pauses; no SMS', async () => {
  const ctx = await setup({ handler: () => json({ status: 403 }, 403) });
  const ok = await ctx.gladys.fake.action('check_account', {});
  assert.match(ok.data.message.fr, /accepté la clé ; son rôle/);
  assert.equal(status(ctx.gladys).connected, true);
  ctx.api.handler = () => json({}, 401);
  const refused = await ctx.gladys.fake.action('check_account', {});
  assert.match(refused.data.message.fr, /API de compte smsmode a refusé la clé \(401\)/);
  assert.equal(status(ctx.gladys).connected, true, 'the account route is secondary');
  assert.equal(ctx.store.data?.refused ?? null, null);
  ctx.api.handler = (r) => (r.method === 'POST' ? undefined : json({}, 401));
  assert.equal((await ctx.scene({ text: 'x' })).success, true, 'scenes still send');
  // Already refused for sending: the button does not say sending is free.
  ctx.api.handler = () => json({}, 401);
  await ctx.scene({ text: 'x' });
  const blocked = await ctx.gladys.fake.action('check_account', {});
  assert.match(blocked.data.message.fr, /déjà refusée à l'envoi/);
  assert.doesNotMatch(blocked.data.message.fr, /ne bloque pas/);
  ctx.api.handler = (r) => (r.method === 'POST' ? undefined : json({}, 401));
  await ctx.gladys.fake.action('send_test', { phone: '0612345678' });
  ctx.api.handler = () => json({}, 502);
  await ctx.gladys.fake.action('check_account', {});
  const paused = await ctx.gladys.fake.action('check_account', {});
  assert.match(paused.data.message.fr, /pause/);
  const gets = ctx.api.requests.filter((r) => r.method === 'GET');
  assert.ok(gets.every((r) => r.path === '/commons/v1/organisations?page=1&pageSize=1'));
  assert.equal(gets.length, 4, 'nothing during the pause');
  assert.equal(ctx.api.sends().length, 3, 'only the scenes and the test button sent an SMS');
  await ctx.app.stop();
});

test('402 and 403 on a send: the next recipients are not tried, the status says why', async () => {
  for (const [code, pattern] of [
    [402, /crédit/],
    [403, /émetteur/],
  ]) {
    const ctx = await setup({ handler: () => json({}, code) });
    const ack = await ctx.scene({ text: 'x', recipients: '0612345678, 0712345678' });
    assert.equal(ack.success, false);
    assert.equal(ctx.api.sends().length, 1);
    assert.match(status(ctx.gladys).message.fr, pattern);
    assert.equal(status(ctx.gladys).connected, false);
    ctx.api.handler = undefined;
    assert.equal((await ctx.scene({ text: 'x' })).success, true, 'not blocking: smsmode decides');
    assert.equal(status(ctx.gladys).connected, true);
    await ctx.app.stop();
  }
});

test('one request in flight; a full queue refuses; a late job sends nothing', async () => {
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const ctx = await setup({
    config: { ...BASE_CONFIG, max_sms_per_hour: 200 },
    handler: async () => {
      await gate;
      return undefined;
    },
  });
  const acks = [];
  for (let i = 0; i < 21; i += 1) acks.push(ctx.scene({ text: `n${i}` }));
  await ctx.clock.advance(0);
  release();
  const results = await Promise.all(acks);
  assert.equal(ctx.api.peak, 1);
  assert.equal(results.filter((a) => a.success).length, 20);
  assert.match(results.find((a) => !a.success).error, /attendent leur tour/);
  await ctx.app.stop();
});

test('a job whose time is over sends nothing', async () => {
  const ctx = await setup({
    handler: async () => {
      // smsmode takes 26 s (the virtual clock moves; the real timeout is not reached):
      // 14 s are left, less than a request and its two saves need.
      await ctx.clock.advance(26 * SECOND);
      return undefined;
    },
  });
  const ack = await ctx.scene({ text: 'x', recipients: '0612345678, 0712345678' });
  assert.equal(ack.data.outputs.sent, 1);
  assert.equal(ack.data.outputs.not_sent, 1, 'the second has 14 s left: not enough');
  assert.equal(ctx.api.sends().length, 1);
  await ctx.app.stop();
});

test('getConfig failing in connected: retried, spaced, the status says it, then it works', async () => {
  let fail = 2;
  let calls = 0;
  const ctx = await setup({
    start: false,
    getConfig: async () => {
      calls += 1;
      // The first read is the SDK's own, inside connect().
      if (calls > 1 && fail > 0) {
        fail -= 1;
        throw new Error('503');
      }
      return BASE_CONFIG;
    },
  });
  await ctx.gladys.connect();
  await ctx.wait(0);
  assert.equal(status(ctx.gladys).connected, false);
  assert.match(status(ctx.gladys).message.fr, /nouvel essai dans 5 s/);
  const early = await ctx.scene({ text: 'x' });
  assert.match(early.error, /configuration n'est pas encore lue/);
  assert.equal(ctx.api.requests.length, 0);
  await ctx.wait(5 * SECOND);
  assert.match(status(ctx.gladys).message.fr, /nouvel essai dans 10 s/);
  await ctx.wait(10 * SECOND);
  assert.equal(calls, 4, 'SDK, app, retry at 5 s, retry at 10 s');
  assert.equal(status(ctx.gladys).connected, true);
  assert.equal((await ctx.scene({ text: 'x' })).success, true);
  await ctx.app.stop();
});

test('/data unreadable: sends go, nothing overwritten, read again every 10 s', async () => {
  const store = createMemoryStore({
    sends: [{ wall: NOW - MINUTE, parts: 1 }],
    salt: 'a'.repeat(32),
  });
  store.unreadable = true;
  const ctx = await setup({ store, config: { ...BASE_CONFIG, max_sms_per_hour: 2 } });
  assert.match(status(ctx.gladys).message.fr, /\/data est illisible/);
  assert.equal((await ctx.scene({ text: 'a' })).success, true);
  assert.equal(store.saves, 0, 'never written over');
  store.unreadable = false;
  await ctx.wait(10 * SECOND);
  // Read back: the SMS of before plus this run's one fill the cap.
  assert.match((await ctx.scene({ text: 'b' })).error, /plafond/);
  assert.equal(store.data.sends.length, 2);
  assert.equal(store.data.salt, 'a'.repeat(32));
  await ctx.app.stop();
});

test('a /data save that fails does not stop the send; the cap still holds in memory', async () => {
  const store = createMemoryStore();
  const ctx = await setup({ store, config: { ...BASE_CONFIG, max_sms_per_hour: 1 } });
  store.failSave = true;
  assert.equal((await ctx.scene({ text: 'a' })).success, true);
  assert.match((await ctx.scene({ text: 'b' })).error, /plafond/);
  await ctx.app.stop();
});

test('stop: a queued job sends nothing, and nothing leaves afterwards', async () => {
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const ctx = await setup({
    handler: async () => {
      await gate;
      return undefined;
    },
  });
  const first = ctx.scene({ text: 'a' });
  const second = ctx.scene({ text: 'b' });
  await ctx.clock.advance(0);
  const stopping = ctx.app.stop();
  release();
  await stopping;
  assert.equal((await first).success, true, 'the one in flight finishes');
  assert.match((await second).error, /arrêtée/);
  assert.equal(ctx.api.sends().length, 1);
  assert.equal(ctx.store.data.sends.length, 1, 'nothing counted nor written for the queued job');
  await ctx.wait(HOUR);
  assert.equal(ctx.api.sends().length, 1);
  assert.equal(ctx.clock.pending, 0, 'no timer left');
});

test('the key and whole numbers never reach the logs, the statuses nor /data', async () => {
  const ctx = await setup({
    config: { ...BASE_CONFIG, default_recipients: '06 12 34 56 78, +44 7700 900123' },
    handler: (r) => (r.body?.recipient.to.startsWith('44') ? 'timeout' : undefined),
  });
  await ctx.scene({ text: 'secret text' });
  ctx.api.handler = () => json({}, 401);
  await ctx.scene({ text: 'x' });
  await ctx.gladys.fake.action('check_account', {});
  const all = leaked(ctx);
  for (const secret of [
    KEY,
    '33612345678',
    '0612345678',
    '447700900123',
    '7700900123',
    'secret text',
  ]) {
    assert.ok(!all.includes(secret), secret);
  }
  assert.match(all, /336\*+78/, 'masked numbers are logged');
  await ctx.app.stop();
});

test('a large or broken 201 answer is still a success', async () => {
  const ctx = await setup({ handler: () => new Response('x'.repeat(100_000), { status: 201 }) });
  const ack = await ctx.scene({ text: 'x' });
  assert.equal(ack.success, true);
  assert.equal(ack.data.outputs.message_ids, '');
  await ctx.app.stop();
});

test('the key fingerprint has 8 bits: every value is shared by many keys', () => {
  const salt = 'b'.repeat(32);
  const seen = new Map();
  for (let i = 0; i < 4096; i += 1) {
    const mark = keyMark(salt, `key-${i}`);
    assert.match(mark, /^[0-9a-f]{2}$/);
    seen.set(mark, (seen.get(mark) ?? 0) + 1);
  }
  assert.equal(seen.size, 256);
  assert.ok(Math.min(...seen.values()) >= 2, 'no mark points to one key');
});

test('App: a send before start is refused', async () => {
  const app = new App({ gladys: {}, store: createMemoryStore(), logger: { warn() {} } });
  await assert.rejects(app.send({ text: 'x', budget: 1000 }), /config_unread/);
});

/** A memory store whose load waits for `release()` (a slow or hung /data). */
function slowStore(initial) {
  const store = createMemoryStore(initial);
  const load = store.load;
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  store.release = release;
  store.load = async () => {
    await gate;
    return load();
  };
  return store;
}

test('a send waits for the first /data read: a slow read does not bypass the cap', async () => {
  const store = slowStore({ sends: [1, 2, 3].map((i) => ({ wall: NOW - i * MINUTE, parts: 1 })) });
  const ctx = await setup({ store, config: { ...BASE_CONFIG, max_sms_per_hour: 3 } });
  const pending = ctx.scene({ text: 'x' });
  await ctx.clock.advance(2 * SECOND);
  store.release();
  const ack = await pending;
  assert.match(ack.error, /plafond/);
  assert.equal(ctx.api.requests.length, 0);
  await ctx.app.stop();
});

test('a /data read that hangs: unreadable after 3 s (status), sends go, written when it ends', async () => {
  const store = slowStore({ sends: [{ wall: NOW - MINUTE, parts: 1 }] });
  const ctx = await setup({ store, config: { ...BASE_CONFIG, max_sms_per_hour: 5 } });
  const pending = ctx.scene({ text: 'x' });
  await ctx.clock.advance(3200);
  const ack = await pending;
  assert.equal(ack.success, true, ack.error);
  assert.match(status(ctx.gladys).message.fr, /\/data est illisible/);
  assert.equal(store.saves, 0, 'nothing written over a /data not read');
  await ctx.wait(30 * SECOND);
  assert.equal(ctx.api.sends().length, 1);
  store.release();
  await ctx.wait(0);
  await ctx.wait(0);
  assert.equal(store.data.sends.length, 2, 'the send of this run is written with the old one');
  assert.doesNotMatch(status(ctx.gladys).message.fr, /illisible/);
  await ctx.app.stop();
});

test('the send is written to /data before its request leaves (a crash keeps it counted)', async () => {
  const store = createMemoryStore();
  let seen;
  const first = await setup({
    store,
    config: { ...BASE_CONFIG, max_sms_per_hour: 1 },
    handler: () => {
      seen = store.data?.sends?.length;
      return new Promise(() => {}); // the process dies during the request
    },
  });
  first.scene({ text: 'x' });
  await first.clock.advance(0);
  await first.clock.advance(0);
  assert.equal(seen, 1, 'counted in /data when the request left');
  const again = await setup({ store, config: { ...BASE_CONFIG, max_sms_per_hour: 1 } });
  assert.match((await again.scene({ text: 'y' })).error, /plafond/);
  assert.equal(again.api.requests.length, 0);
  await again.app.stop();
});

test('stop during the save before a send: the request never leaves', async () => {
  const store = createMemoryStore();
  const ctx = await setup({ store });
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const save = store.save;
  store.save = async (data) => {
    await gate;
    return save(data);
  };
  const pending = ctx.scene({ text: 'x' });
  await ctx.clock.advance(0);
  const stopping = ctx.app.stop();
  release();
  await stopping;
  assert.match((await pending).error, /arrêtée/);
  assert.equal(ctx.api.requests.length, 0);
});

test('the check button waits in the same queue: one request in flight, queue bounded', async () => {
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const ctx = await setup({
    config: { ...BASE_CONFIG, max_sms_per_hour: 200 },
    handler: async () => {
      await gate;
      return undefined;
    },
  });
  const acks = [];
  for (let i = 0; i < 20; i += 1) acks.push(ctx.scene({ text: `n${i}` }));
  await ctx.clock.advance(0);
  const full = await ctx.gladys.fake.action('check_account', {});
  assert.match(full.data.message.fr, /attendent leur tour/);
  release();
  await Promise.all(acks);
  let releaseLast;
  const last = new Promise((resolve) => (releaseLast = resolve));
  ctx.api.handler = async (r) => {
    if (r.method === 'POST') await last;
    return undefined;
  };
  const slow = ctx.scene({ text: 'last' });
  await ctx.clock.advance(0);
  const check = ctx.gladys.fake.action('check_account', {});
  await ctx.clock.advance(0);
  assert.equal(ctx.api.requests.filter((r) => r.method === 'GET').length, 0, 'waits its turn');
  releaseLast();
  await Promise.all([slow, check]);
  assert.equal(ctx.api.peak, 1);
  assert.equal(ctx.api.requests.filter((r) => r.method === 'GET').length, 1);
  await ctx.app.stop();
});

test('a refusal seen before /data is read is kept under the salt of /data', async () => {
  const store = createMemoryStore({ salt: 'c'.repeat(32), refused: null });
  store.unreadable = true;
  const ctx = await setup({ store, handler: () => json({}, 401) });
  await ctx.scene({ text: 'x' });
  ctx.api.handler = undefined;
  store.unreadable = false;
  await ctx.wait(10 * SECOND);
  assert.equal(store.data.salt, 'c'.repeat(32));
  assert.equal(store.data.refused, keyMark('c'.repeat(32), KEY));
  assert.match((await ctx.scene({ text: 'x' })).error, /refusée/);
  await ctx.app.stop();
});

test('a /data write that fails is said in the status, and cleared by the next success', async () => {
  const store = createMemoryStore();
  const ctx = await setup({ store });
  store.failSave = true;
  await ctx.scene({ text: 'x' });
  await ctx.wait(0);
  assert.match(status(ctx.gladys).message.fr, /n'a pas pu être écrit/);
  assert.equal(status(ctx.gladys).connected, true);
  store.failSave = false;
  await ctx.scene({ text: 'y' });
  await ctx.wait(0);
  assert.doesNotMatch(status(ctx.gladys).message.fr, /écrit/);
  await ctx.app.stop();
});

test('STOP: its room is kept when cutting, and it counts in the parts and the cap', async () => {
  const ctx = await setup({
    config: { ...BASE_CONFIG, stop_mention: true, max_parts: 1, max_sms_per_hour: 3 },
  });
  const ack = await ctx.scene({ text: 'a'.repeat(300) });
  assert.equal(ack.data.outputs.truncated, true);
  assert.equal(ctx.api.sends()[0].body.body.text.length, 140, '160 minus 20 for STOP');
  assert.equal(ctx.api.sends()[0].body.body.stop, true);
  await ctx.app.stop();
  const two = await setup({
    config: { ...BASE_CONFIG, stop_mention: true, max_parts: 3, max_sms_per_hour: 3 },
  });
  // 150 characters + STOP: 2 SMS.
  assert.equal((await two.scene({ text: 'b'.repeat(150) })).success, true);
  assert.match((await two.scene({ text: 'c'.repeat(150) })).error, /plafond/);
  assert.equal((await two.scene({ text: 'short' })).success, true, '2 + 1 = 3');
  await two.app.stop();
});
