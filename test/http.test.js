import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SmsError, readBounded, request, retryAfterMs } from '../src/http.js';
import { fetchError, json } from './helpers/app.js';

const call = (out, { get = false } = {}) =>
  request('/sms/v1/messages', {
    apiKey: 'k'.repeat(20),
    body: get ? undefined : { x: 1 },
    fetchImpl: async () => {
      if (typeof out === 'string') throw fetchError(out);
      return out;
    },
    now: () => Date.parse('2026-11-14T09:00:00Z'),
  });

test('Retry-After: seconds or an HTTP date, nothing else', () => {
  const now = Date.parse('2026-11-14T09:00:00Z');
  assert.equal(retryAfterMs('120', now), 120_000);
  assert.equal(retryAfterMs('Sat, 14 Nov 2026 09:05:00 GMT', now), 300_000);
  assert.equal(retryAfterMs('Sat, 14 Nov 2026 08:00:00 GMT', now), 0);
  for (const bad of [undefined, '', '-5', '1.5', '2026-11-14', 'x'.repeat(100)]) {
    assert.equal(retryAfterMs(bad, now), undefined, String(bad));
  }
});

test('a body larger than the bound is cut before being read whole', async () => {
  const declared = new Response('x', { headers: { 'content-length': '999999' } });
  await assert.rejects(readBounded(declared, 100), { code: 'too_large' });
  let pulled = 0;
  const stream = new ReadableStream({
    pull(controller) {
      pulled += 1;
      controller.enqueue(new Uint8Array(1000));
      if (pulled > 1000) controller.close();
    },
  });
  await assert.rejects(readBounded(new Response(stream), 5000), { code: 'too_large' });
  assert.ok(pulled < 20, `stopped early (${pulled} chunks)`);
  assert.equal(await readBounded(new Response('{"a":1}'), 100), '{"a":1}');
});

test('each status says whether the SMS may have left', async () => {
  for (const [out, code, sent] of [
    [json({}, 400), 'invalid', 'no'],
    [json({}, 401), 'refused', 'no'],
    [json({}, 402), 'credit', 'no'],
    [json({}, 403), 'forbidden', 'no'],
    [json({}, 404), 'http', 'no'],
    [json({}, 406), 'http', 'no'],
    [json({}, 429), 'rate_limited', 'no'],
    [json({}, 500), 'server', 'maybe'],
    [json({}, 503), 'server', 'maybe'],
    [new Response(null, { status: 301 }), 'redirect', 'no'],
    ['timeout', 'timeout', 'maybe'],
    ['ECONNRESET', 'network', 'maybe'],
    ['UND_ERR_SOCKET', 'network', 'maybe'],
    ['ENOTFOUND', 'network', 'no'],
    ['ECONNREFUSED', 'network', 'no'],
    ['UND_ERR_CONNECT_TIMEOUT', 'network', 'no'],
    ['ERR_TLS_CERT_ALTNAME_INVALID', 'network', 'no'],
  ]) {
    await assert.rejects(call(out), (err) => {
      assert.ok(err instanceof SmsError);
      assert.equal(err.code, code, `${out.status ?? out}`);
      assert.equal(err.sent, sent, `${out.status ?? out}`);
      return true;
    });
  }
  // A GET (the check) never "may have left".
  await assert.rejects(call('timeout', { get: true }), { code: 'timeout', sent: 'no' });
  await assert.rejects(call(json({}, 500), { get: true }), { code: 'server', sent: 'no' });
});

test('a 4xx gives its error code only, never its free text', async () => {
  await assert.rejects(
    call(json({ errorCode: 'RECIPIENT_TO_INVALID', message: 'Invalid 33612345678' }, 400)),
    (err) => err.detail === 'RECIPIENT_TO_INVALID' && !err.message.includes('336'),
  );
  await assert.rejects(
    call(json({ errorCode: 'Invalid 33612345678' }, 400)),
    (err) => err.detail === undefined,
  );
  await assert.rejects(call(new Response('not json', { status: 400 })), { detail: undefined });
});

test('a 429 carries Retry-After, read against the server date', async () => {
  await assert.rejects(call(json({}, 429, { 'retry-after': '90' })), { retryAfter: 90_000 });
  await assert.rejects(
    call(
      json({}, 429, {
        'retry-after': 'Sat, 14 Nov 2026 12:02:00 GMT',
        date: 'Sat, 14 Nov 2026 12:00:00 GMT',
      }),
    ),
    { retryAfter: 120_000 },
  );
});

test('headers: key, JSON both ways, User-Agent; GET without a body', async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url, init });
    return json({ ok: true }, 201);
  };
  const out = await request('/sms/v1/messages', {
    apiKey: 'K'.repeat(12),
    body: { a: 1 },
    fetchImpl,
  });
  assert.deepEqual(out, { status: 201, json: { ok: true } });
  await request('/commons/v1/organisations?page=1&pageSize=1', {
    apiKey: 'K'.repeat(12),
    fetchImpl,
  });
  const [post, get] = seen;
  assert.equal(post.init.method, 'POST');
  assert.equal(post.init.headers['Content-Type'], 'application/json');
  assert.equal(post.init.body, '{"a":1}');
  assert.equal(get.init.method, 'GET');
  assert.equal(get.init.body, undefined);
  assert.equal(get.init.headers['Content-Type'], undefined);
  assert.equal(get.url, 'https://rest.smsmode.com/commons/v1/organisations?page=1&pageSize=1');
  for (const { init } of seen) {
    assert.equal(init.headers['X-Api-Key'], 'K'.repeat(12));
    assert.equal(init.headers.Accept, 'application/json');
    assert.match(
      init.headers['User-Agent'],
      /^gladys-smsmode\/0\.1\.0 \(\+https:\/\/github\.com\/LM1LC3N7\/gladys-smsmode\)$/,
    );
    assert.equal(init.redirect, 'manual');
  }
});
