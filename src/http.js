// -----------------------------------------------------------------------------
// The only network code: one HTTPS request to smsmode, with a timeout, the
// module's User-Agent, `Accept: application/json` (smsmode answers 406
// without it), no redirect followed, and an answer read up to a bound.
//
// Every failure says whether the SMS may have left (`sent`):
//   - 'no'    : nothing was accepted (a 4xx, a redirect, a name or connection
//               refused before the request left);
//   - 'maybe' : the request may have reached smsmode (a timeout, a connection
//               cut, a 5xx). Such a send is never tried again: a second try
//               could be a second paid SMS.
// The API key travels in the X-Api-Key header only; no message here ever
// contains it, nor a phone number, nor what smsmode answered word for word.
// -----------------------------------------------------------------------------

import { API_BASE, HTTP_TIMEOUT, MAX_ANSWER_BYTES, USER_AGENT } from './constants.js';

export class SmsError extends Error {
  /**
   * `code`: 'refused' (401), 'credit' (402), 'forbidden' (403), 'invalid' (400),
   * 'rate_limited' (429), 'server' (5xx), 'http' (other status), 'redirect',
   * 'timeout', 'network', 'too_large', 'unreadable'.
   */
  constructor(code, { status, sent = 'no', retryAfter, detail } = {}) {
    super(status ? `smsmode answered ${status} (${code})` : `smsmode request failed (${code})`);
    this.name = 'SmsError';
    this.code = code;
    this.status = status;
    this.sent = sent;
    this.retryAfter = retryAfter;
    this.detail = detail;
  }
}

/** Connection failures that happen before the request is written: nothing left. */
const BEFORE_SENDING =
  /^(ENOTFOUND|EAI_AGAIN|ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|EADDRNOTAVAIL|UND_ERR_CONNECT_TIMEOUT|ERR_TLS_|CERT_|DEPTH_ZERO|SELF_SIGNED|UNABLE_TO_|ERR_SSL_)/;

/** Retry-After (seconds or an HTTP date) -> milliseconds, undefined when absent or invalid. */
export function retryAfterMs(value, now) {
  if (typeof value !== 'string' || value.length > 64) return undefined;
  if (/^\d+$/.test(value.trim())) return Number(value) * 1000;
  if (!/^[A-Za-z]{3}, /.test(value)) return undefined;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : undefined;
}

/** The body as text, refused past `limit` bytes (read in chunks, never whole). */
export async function readBounded(response, limit) {
  const tooLarge = () => new SmsError('too_large', { status: response.status });
  const declared = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared > limit) {
    await response.body?.cancel?.().catch(() => {});
    throw tooLarge();
  }
  if (!response.body?.getReader) {
    const text = await response.text();
    if (Buffer.byteLength(text) > limit) throw tooLarge();
    return text;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => {});
      throw tooLarge();
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** The smsmode error code of a 4xx answer ("400.029"), never its free text. */
function errorCode(text) {
  try {
    const json = JSON.parse(text);
    const code = json?.errorCode ?? json?.type;
    return typeof code === 'string' && /^(?:\d{3}\.\d{3}|[A-Za-z_][A-Za-z_.-]{2,59})$/.test(code)
      ? code
      : undefined;
  } catch {
    return undefined;
  }
}

function failure(err, sentIfUnknown) {
  if (err instanceof SmsError) return err;
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
    return new SmsError('timeout', { sent: sentIfUnknown });
  }
  const code = String(err?.cause?.code ?? err?.code ?? '');
  return new SmsError('network', { sent: BEFORE_SENDING.test(code) ? 'no' : sentIfUnknown });
}

/**
 * One request. Resolves `{ status, json }` (json undefined when a 2xx body does
 * not read); throws an SmsError otherwise. `post` marks a send: a failure whose
 * outcome is unknown is then `sent: 'maybe'`.
 */
export async function request(
  path,
  {
    apiKey,
    body,
    fetchImpl = globalThis.fetch,
    now = Date.now,
    timeout = HTTP_TIMEOUT,
    limit = MAX_ANSWER_BYTES,
  },
) {
  const post = body !== undefined;
  const unknown = post ? 'maybe' : 'no';
  const headers = { 'User-Agent': USER_AGENT, Accept: 'application/json', 'X-Api-Key': apiKey };
  if (post) headers['Content-Type'] = 'application/json';
  const signal = AbortSignal.timeout(Math.max(1, timeout));
  let response;
  try {
    response = await fetchImpl(`${API_BASE}${path}`, {
      method: post ? 'POST' : 'GET',
      headers,
      body: post ? JSON.stringify(body) : undefined,
      signal,
      redirect: 'manual',
    });
  } catch (err) {
    throw failure(err, unknown);
  }
  const { status } = response;
  if (status >= 200 && status < 300) {
    // Accepted: an answer that does not read never turns it into a failure.
    let json;
    try {
      json = JSON.parse(await readBounded(response, limit));
    } catch {
      json = undefined;
    }
    return { status, json };
  }
  let text = '';
  try {
    if (status >= 400 && status < 500) text = await readBounded(response, 4096);
    else await response.body?.cancel?.().catch(() => {});
  } catch {
    text = '';
  }
  if (status >= 300 && status < 400) throw new SmsError('redirect', { status });
  if (status === 401) throw new SmsError('refused', { status });
  if (status === 402) throw new SmsError('credit', { status });
  if (status === 403) throw new SmsError('forbidden', { status, detail: errorCode(text) });
  if (status === 400) throw new SmsError('invalid', { status, detail: errorCode(text) });
  if (status === 429) {
    const served = Date.parse(response.headers?.get?.('date') ?? '');
    throw new SmsError('rate_limited', {
      status,
      retryAfter: retryAfterMs(
        response.headers?.get?.('retry-after'),
        Number.isFinite(served) ? served : now(),
      ),
    });
  }
  // A 5xx to a send: smsmode may have taken it before failing.
  if (status >= 500) throw new SmsError('server', { status, sent: unknown });
  throw new SmsError('http', { status });
}
