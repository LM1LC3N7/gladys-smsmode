// -----------------------------------------------------------------------------
// The integration: sends SMS through smsmode when a scene reaches the "Send an
// SMS" action or the user clicks the test button, and at no other time (no
// polling, nothing at start, nothing on a configuration change).
//
// Guards, in the order a send meets them:
//   - one request in flight at a time (a queue of 20 at most, each job with
//     its own deadline: a job whose time is over sends nothing);
//   - a pause after a 429 (Retry-After, bounded 60 s to 6 h) or a 5xx (60 s,
//     doubled on repeat, 6 h at most), kept in /data;
//   - a refused key (401) is never sent again by a scene: its 8-bit salted
//     fingerprint is kept in /data, lifted by a new key or by a success of a
//     button;
//   - the hourly cap: the SMS billed in the last 60 minutes (parts counted)
//     plus this one must not pass `max_sms_per_hour`. A send is counted before
//     its request leaves, and given back only when smsmode surely did not take
//     it; the times are kept in /data so a restart does not reset the cap;
//   - a send that may have left (timeout, connection cut, 5xx) is never tried
//     again: a second try could be a second paid SMS.
//
// Clocks: `monotonic` decides (cap window, pause, deadlines); `now` (wall)
// only dates /data and the status.
// -----------------------------------------------------------------------------

import { createHmac, randomBytes } from 'node:crypto';
import {
  ACCOUNT_PATH,
  BUTTON_BUDGET,
  CAP_WINDOW,
  HTTP_TIMEOUT,
  MAX_QUEUE,
  MAX_SENDS_KEPT,
  PAUSE_MAX,
  PAUSE_MIN,
  SAVE_TIMEOUT,
  SCENE_BUDGET,
  SEND_PATH,
  STATUS_TIMEOUT,
  STORE_RETRY,
} from './constants.js';
import { normalizeConfig } from './config.js';
import { SmsError, request } from './http.js';
import { T, parisTime, reasonMessage, sceneError } from './i18n.js';
import { PhoneError, mask, normalizePhone, parseRecipients } from './phone.js';
import { prepareText } from './text.js';

const realTimers = { setTimeout, clearTimeout };
const CONFIG_RETRY = [5_000, 10_000, 30_000, 60_000, 300_000];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Failures after which the remaining recipients of the same message are not tried. */
const STOPS_ALL = new Set([
  'refused',
  'credit',
  'forbidden',
  'rate_limited',
  'server',
  'timeout',
  'network',
  'redirect',
  'http',
  'too_large',
]);

/** A refused send: nothing left. `code` is a key of T.reason. */
export class NotSent extends Error {
  constructor(code) {
    super(code);
    this.name = 'NotSent';
    this.code = code;
  }
}

/** The 8-bit fingerprint of a key: enough to recognise it, never to find it back. */
export const keyMark = (salt, key) =>
  createHmac('sha256', salt).update(String(key)).digest('hex').slice(0, 2);

export class App {
  constructor({
    gladys,
    logger = console,
    now = Date.now,
    monotonic = () => performance.now(),
    timers = realTimers,
    store,
    fetchImpl = (...args) => globalThis.fetch(...args),
    random = (n) => randomBytes(n).toString('hex'),
  }) {
    Object.assign(this, { gladys, logger, now, monotonic, timers, store, fetchImpl, random });
    this.config = undefined;
    this.configTries = 0;
    this.configTimer = undefined;
    this.configReading = undefined;
    /** /data: undefined (not read yet), 'ok', 'missing' or 'unreadable'. */
    this.dataState = undefined;
    this.loading = undefined;
    this.storeTimer = undefined;
    this.salt = undefined;
    this.refusedMark = undefined;
    /** SMS counted for the cap: { mono, wall, parts }. */
    this.sends = [];
    this.pause = { untilMono: 0, untilWall: 0, why: undefined, streak: 0 };
    this.pauseTimer = undefined;
    this.lastIssue = undefined;
    this.queue = Promise.resolve();
    this.waiting = 0;
    this.running = false;
    this.generation = 0;
    this.lastStatus = undefined;
    this.statusJob = Promise.resolve();
  }

  // --- Life cycle ---------------------------------------------------------------

  async start() {
    this.running = true;
    const gen = (this.generation += 1);
    this.loadState();
    await this.readConfig(gen);
  }

  /** Every (re)connection: started once, then the config read again and the status re-sent. */
  async connected() {
    if (!this.running) return this.start();
    this.lastStatus = undefined;
    await this.readConfig(this.generation);
    this.publishStatus();
  }

  async stop() {
    this.running = false;
    this.generation += 1;
    for (const key of ['configTimer', 'storeTimer', 'pauseTimer']) {
      if (this[key]) this.timers.clearTimeout(this[key]);
      this[key] = undefined;
    }
    await this.idle();
  }

  /** Resolves when the queued sends and the status are done (tests, stop). */
  async idle() {
    await this.queue;
    await this.statusJob;
  }

  // --- Configuration ------------------------------------------------------------

  /** Reads the configuration; on failure, again later, spaced, without end. */
  async readConfig(gen) {
    if (this.configReading) return this.configReading;
    this.configReading = (async () => {
      try {
        const raw = await this.gladys.getConfig();
        if (gen !== this.generation) return;
        this.applyConfig(raw);
      } catch (err) {
        if (gen !== this.generation) return;
        const delay = CONFIG_RETRY[Math.min(this.configTries, CONFIG_RETRY.length - 1)];
        this.configTries += 1;
        this.logger.warn(
          `Configuration not read (${err?.message ?? err}): new try in ${delay / 1000} s`,
        );
        if (!this.config)
          this.publishStatus({ connected: false, message: T.status.config_unread(delay / 1000) });
        if (this.configTimer) this.timers.clearTimeout(this.configTimer);
        this.configTimer = this.timers.setTimeout(() => {
          this.configTimer = undefined;
          if (this.running && gen === this.generation) this.readConfig(gen);
        }, delay);
      } finally {
        this.configReading = undefined;
      }
    })();
    return this.configReading;
  }

  applyConfig(raw) {
    this.config = normalizeConfig(raw ?? {});
    this.configTries = 0;
    if (this.configTimer) this.timers.clearTimeout(this.configTimer);
    this.configTimer = undefined;
    this.publishStatus();
  }

  /** onConfigUpdated: nothing is sent, only the status changes. */
  configUpdated(raw) {
    this.applyConfig(raw);
  }

  /** The config for a send: read once more (bounded) when not read yet. */
  async configForSend() {
    if (!this.config && this.running) {
      let timer;
      const late = new Promise((resolve) => {
        timer = this.timers.setTimeout(resolve, 3_000);
      });
      await Promise.race([this.readConfig(this.generation), late]);
      this.timers.clearTimeout(timer);
    }
    if (!this.config) throw new NotSent('config_unread');
    return this.config;
  }

  // --- /data ----------------------------------------------------------------------

  /** One read at a time; unreadable: again every 10 s; never awaited by a send. */
  loadState() {
    if (this.loading || this.dataState === 'ok' || this.dataState === 'missing') return;
    const gen = this.generation;
    this.loading = Promise.resolve()
      .then(() => this.store.load())
      .catch(() => ({ status: 'unreadable' }))
      .then((result) => {
        this.loading = undefined;
        if (gen !== this.generation || !this.running) return;
        this.restore(result);
      });
  }

  restore(result) {
    if (result.status === 'unreadable') {
      if (this.dataState !== 'unreadable')
        this.logger.warn('/data is unreadable: read again every 10 s');
      this.dataState = 'unreadable';
      this.publishStatus();
      if (!this.storeTimer) {
        this.storeTimer = this.timers.setTimeout(() => {
          this.storeTimer = undefined;
          if (this.running) this.loadState();
        }, STORE_RETRY);
      }
      return;
    }
    const data = result.status === 'ok' ? result.data : {};
    const wall = this.now();
    const mono = this.monotonic();
    // The sends of the last hour. A time in the future (a wall clock set back)
    // is counted as now: the cap stays on the safe side for at most an hour.
    const kept = [];
    for (const item of Array.isArray(data.sends) ? data.sends.slice(-MAX_SENDS_KEPT) : []) {
      const parts = item?.parts;
      if (typeof item?.wall !== 'number' || !Number.isFinite(item.wall)) continue;
      if (!Number.isInteger(parts) || parts < 1 || parts > 10) continue;
      const age = Math.max(0, wall - item.wall);
      if (age >= CAP_WINDOW) continue;
      kept.push({ mono: mono - age, wall: Math.min(item.wall, wall), parts });
    }
    this.sends = [...kept, ...this.sends].slice(-MAX_SENDS_KEPT);
    // The pause: a remaining time bounded by the maximum.
    const until = data.pause?.until;
    if (typeof until === 'number' && Number.isFinite(until) && until > wall) {
      const left = Math.min(until - wall, PAUSE_MAX);
      if (mono + left > this.pause.untilMono) {
        this.setPause(left, data.pause.why === 'rate_limited' ? 'rate_limited' : 'server', false);
      }
      if (Number.isInteger(data.pause.streak) && data.pause.streak >= 0 && data.pause.streak < 20) {
        this.pause.streak = Math.max(this.pause.streak, data.pause.streak);
      }
    }
    // The refused key: its mark under the salt of /data.
    const oldSalt = this.salt;
    const oldMark = this.refusedMark;
    if (typeof data.salt === 'string' && /^[0-9a-f]{32}$/.test(data.salt)) {
      this.salt = data.salt;
      this.refusedMark =
        typeof data.refused === 'string' && /^[0-9a-f]{2}$/.test(data.refused)
          ? data.refused
          : undefined;
    }
    // A refusal seen in this run (before /data read) is kept under the new salt.
    const key = this.config?.apiKey;
    if (oldMark && oldSalt && key && keyMark(oldSalt, key) === oldMark) this.markRefused(key);
    const wasUnreadable = this.dataState === 'unreadable';
    this.dataState = result.status;
    this.publishStatus();
    // What this run counted while /data was unreadable is written now.
    if (wasUnreadable) this.save();
  }

  snapshot() {
    return {
      salt: this.salt,
      refused: this.refusedMark ?? null,
      pause:
        this.pause.untilMono > this.monotonic()
          ? { until: this.pause.untilWall, why: this.pause.why, streak: this.pause.streak }
          : { streak: this.pause.streak },
      sends: this.sends.map(({ wall, parts }) => ({ wall, parts })),
    };
  }

  /** Saves the state, bounded in time; never over an unreadable /data. Resolves true when saved. */
  async save() {
    if (this.dataState !== 'ok' && this.dataState !== 'missing') return false;
    if (!this.salt) this.salt = this.random(16);
    let timer;
    const late = new Promise((resolve) => {
      timer = this.timers.setTimeout(() => resolve('timeout'), SAVE_TIMEOUT);
    });
    try {
      const job = this.store.save(this.snapshot()).then(() => 'ok');
      job.catch(() => {});
      const outcome = await Promise.race([job, late]);
      if (outcome !== 'ok') this.logger.warn('/data not saved in time');
      else if (this.dataState === 'missing') this.dataState = 'ok';
      return outcome === 'ok';
    } catch (err) {
      this.logger.warn(`/data not saved: ${err?.code ?? err?.message ?? err}`);
      return false;
    } finally {
      this.timers.clearTimeout(timer);
    }
  }

  // --- Guards -----------------------------------------------------------------------

  markRefused(key) {
    if (!this.salt) this.salt = this.random(16);
    this.refusedMark = keyMark(this.salt, key);
  }

  isRefused(key) {
    return Boolean(this.refusedMark && this.salt && keyMark(this.salt, key) === this.refusedMark);
  }

  /** A pause of `ms` (60 s to 6 h; a pause read back from /data keeps its remaining time). */
  setPause(ms, why, grow = true) {
    const delay = Math.min(PAUSE_MAX, Math.max(grow ? PAUSE_MIN : 1, ms));
    const mono = this.monotonic();
    this.pause.untilMono = mono + delay;
    this.pause.untilWall = this.now() + delay;
    this.pause.why = why;
    if (grow) this.pause.streak = Math.min(this.pause.streak + 1, 19);
    if (this.pauseTimer) this.timers.clearTimeout(this.pauseTimer);
    this.pauseTimer = this.timers.setTimeout(() => {
      this.pauseTimer = undefined;
      this.publishStatus();
    }, delay + 1);
  }

  paused(mono) {
    return mono < this.pause.untilMono;
  }

  /** Parts counted in the 60 minutes before `mono`. */
  used(mono) {
    this.sends = this.sends.filter((s) => mono - s.mono < CAP_WINDOW);
    return this.sends.reduce((sum, s) => sum + s.parts, 0);
  }

  // --- Sending ------------------------------------------------------------------------

  /**
   * Sends `rawText` to the numbers typed (or the default ones). Resolves the
   * outcome `{ accepted, uncertain, notSent, ids, reasons, truncated }`;
   * throws NotSent when nothing could start.
   */
  async send({ recipients: rawRecipients, text: rawText, budget, button = false }) {
    const start = this.monotonic();
    const deadline = start + budget;
    const config = await this.configForSend();
    if (config.issues.includes('no_key')) throw new NotSent('no_key');
    if (config.issues.includes('bad_key')) throw new NotSent('bad_key');
    if (config.issues.includes('bad_sender')) throw new NotSent('bad_sender');
    let numbers;
    const typed = typeof rawRecipients === 'string' && rawRecipients.trim() !== '';
    try {
      numbers = typed ? parseRecipients(rawRecipients) : config.recipients;
    } catch (err) {
      if (!(err instanceof PhoneError)) throw err;
      throw new NotSent(err.code === 'landline' ? 'landline' : 'bad_recipients');
    }
    if (!typed && config.issues.includes('bad_recipients')) throw new NotSent('bad_recipients');
    if (!numbers.length) throw new NotSent('no_recipient');
    const prepared = prepareText(rawText, { maxParts: config.maxParts, accents: config.accents });
    if (!prepared.text) throw new NotSent('empty_text');
    if (this.waiting >= MAX_QUEUE) throw new NotSent('queue_full');

    this.waiting += 1;
    const gen = this.generation;
    const job = this.queue.then(() => this.sendAll({ numbers, prepared, deadline, button, gen }));
    this.queue = job.catch(() => {});
    try {
      return await job;
    } finally {
      this.waiting -= 1;
    }
  }

  async sendAll({ numbers, prepared, deadline, button, gen }) {
    const out = {
      accepted: 0,
      uncertain: 0,
      notSent: 0,
      ids: [],
      reasons: new Set(),
      truncated: prepared.truncated,
    };
    let stopAll;
    for (const to of numbers) {
      if (!stopAll) stopAll = this.blocked({ deadline, gen, button, parts: prepared.parts });
      if (stopAll) {
        out.notSent += 1;
        out.reasons.add(stopAll);
        continue;
      }
      const result = await this.sendOne(to, prepared, gen);
      if (result.ok) {
        out.accepted += 1;
        if (result.id) out.ids.push(result.id);
        continue;
      }
      if (result.sent === 'maybe') out.uncertain += 1;
      else out.notSent += 1;
      out.reasons.add(result.code);
      if (STOPS_ALL.has(result.code)) stopAll = result.code;
    }
    this.publishStatus();
    return out;
  }

  /** Why nothing more may leave now, or undefined. Read once per decision. */
  blocked({ deadline, gen, button, parts }) {
    const mono = this.monotonic();
    if (!this.running || gen !== this.generation) return 'stopped';
    if (deadline - mono < HTTP_TIMEOUT + 500) return 'time';
    if (this.paused(mono)) return 'paused';
    // A button may try a refused key again (its success lifts the refusal).
    if (!button && this.isRefused(this.config.apiKey)) return 'refused';
    if (this.used(mono) + parts > this.config.maxPerHour) return 'cap';
    return undefined;
  }

  async sendOne(to, prepared, gen) {
    const config = this.config;
    const entry = { mono: this.monotonic(), wall: this.now(), parts: prepared.parts };
    // Counted before the request leaves: a crash after it cannot free the slot.
    this.sends.push(entry);
    await this.save();
    if (!this.running || gen !== this.generation) {
      this.release(entry);
      return { ok: false, sent: 'no', code: 'stopped' };
    }
    const body = { recipient: { to }, body: { text: prepared.text, encoding: prepared.encoding } };
    if (config.stop) body.body.stop = true;
    if (config.sender) body.from = config.sender;
    try {
      const { json } = await request(SEND_PATH, {
        apiKey: config.apiKey,
        body,
        fetchImpl: this.fetchImpl,
        now: this.now,
      });
      const id =
        typeof json?.messageId === 'string' && UUID.test(json.messageId)
          ? json.messageId
          : undefined;
      const billed = json?.body?.messagePartCount;
      if (Number.isInteger(billed) && billed > entry.parts && billed <= 10) entry.parts = billed;
      this.pause.streak = 0;
      this.lastIssue = undefined;
      if (this.isRefused(config.apiKey)) this.refusedMark = undefined;
      this.logger.info(`SMS accepted by smsmode for ${mask(to)} (${entry.parts} part(s))`);
      await this.save();
      return { ok: true, id };
    } catch (err) {
      if (!(err instanceof SmsError)) throw err;
      if (err.sent !== 'maybe') this.release(entry);
      this.onFailure(err, config);
      this.logger.warn(
        `SMS to ${mask(to)} ${err.sent === 'maybe' ? 'may have left' : 'not sent'}: ${err.code}${err.status ? ` (${err.status})` : ''}${err.detail ? ` ${err.detail}` : ''}`,
      );
      await this.save();
      return { ok: false, sent: err.sent, code: err.code };
    }
  }

  release(entry) {
    const i = this.sends.indexOf(entry);
    if (i >= 0) this.sends.splice(i, 1);
  }

  /** What a failure changes for the next sends (pause, refusal, status). */
  onFailure(err, config) {
    if (err.code === 'refused') {
      this.markRefused(config.apiKey);
    } else if (err.code === 'rate_limited') {
      this.setPause(err.retryAfter ?? PAUSE_MIN * 2 ** this.pause.streak, 'rate_limited');
    } else if (err.code === 'server') {
      this.setPause(PAUSE_MIN * 2 ** this.pause.streak, 'server');
    } else if (err.code === 'credit' || err.code === 'forbidden') {
      this.lastIssue = err.code;
    }
  }

  // --- Handlers -----------------------------------------------------------------------

  /** Scene action "send_sms": outputs, or an error for the scene log. */
  async sceneSend(fields = {}) {
    let out;
    try {
      out = await this.send({
        recipients: fields.recipients,
        text: fields.text,
        budget: SCENE_BUDGET,
      });
    } catch (err) {
      if (err instanceof NotSent) throw sceneError(reasonMessage(err.code));
      throw err;
    }
    if (!out.accepted) throw sceneError(T.summary(out));
    return {
      sent: out.accepted,
      not_sent: out.notSent + out.uncertain,
      message_ids: out.ids.join(','),
      truncated: out.truncated,
    };
  }

  /** Button "Send a test SMS" to one number. */
  async testSend(fields = {}) {
    const phone = typeof fields.phone === 'string' ? fields.phone.trim() : '';
    if (!phone) return reasonMessage('no_recipient');
    try {
      normalizePhone(phone);
    } catch (err) {
      if (!(err instanceof PhoneError)) throw err;
      return reasonMessage(err.code === 'landline' ? 'landline' : 'bad_recipients');
    }
    try {
      const out = await this.send({
        recipients: phone,
        text: T.testText,
        budget: BUTTON_BUDGET,
        button: true,
      });
      return T.summary(out);
    } catch (err) {
      if (err instanceof NotSent) return reasonMessage(err.code);
      throw err;
    }
  }

  /** Button "Check the key and the credit": no SMS, one GET in the queue. */
  async checkAccount() {
    let config;
    try {
      config = await this.configForSend();
      if (config.issues.includes('no_key')) throw new NotSent('no_key');
      if (config.issues.includes('bad_key')) throw new NotSent('bad_key');
      if (this.waiting >= MAX_QUEUE) throw new NotSent('queue_full');
    } catch (err) {
      if (err instanceof NotSent)
        return reasonMessage(err.code, { en: 'Not checked', fr: 'Non vérifié' });
      throw err;
    }
    this.waiting += 1;
    const gen = this.generation;
    const job = this.queue.then(() => this.runCheck(config, gen));
    this.queue = job.catch(() => {});
    try {
      return await job;
    } finally {
      this.waiting -= 1;
    }
  }

  async runCheck(config, gen) {
    const prefix = { en: 'Not checked', fr: 'Non vérifié' };
    if (!this.running || gen !== this.generation) return reasonMessage('stopped', prefix);
    if (this.paused(this.monotonic())) return reasonMessage('paused', prefix);
    let message;
    try {
      const { json } = await request(ACCOUNT_PATH, {
        apiKey: config.apiKey,
        fetchImpl: this.fetchImpl,
        now: this.now,
      });
      const balance = json?.items?.[0]?.balance;
      const amount = balance?.amount;
      const currency =
        typeof balance?.currency === 'string' && /^[A-Z]{3}$/.test(balance.currency)
          ? balance.currency
          : '';
      const text =
        typeof amount === 'number' && Number.isFinite(amount)
          ? `${amount.toFixed(2)} ${currency}`.trim()
          : '';
      this.refusedMark = undefined;
      this.lastIssue = undefined;
      this.pause.streak = 0;
      message = T.check.ok(text);
    } catch (err) {
      if (!(err instanceof SmsError)) throw err;
      if (err.code === 'forbidden') {
        // Authenticated, only not allowed to read the organisation: the key is good.
        this.refusedMark = undefined;
        message = T.check.no_balance;
      } else {
        this.onFailure(err, config);
        message = reasonMessage(err.code, prefix);
      }
    }
    await this.save();
    this.publishStatus();
    return message;
  }

  // --- Status -------------------------------------------------------------------------

  currentStatus() {
    const c = this.config;
    if (!c) return undefined;
    if (c.issues.includes('no_key')) return { connected: false, message: T.status.no_key };
    if (c.issues.includes('bad_key')) return { connected: false, message: T.status.bad_key };
    if (c.issues.includes('bad_sender')) return { connected: false, message: T.status.bad_sender };
    if (this.isRefused(c.apiKey)) return { connected: false, message: T.status.refused };
    if (this.paused(this.monotonic())) {
      return {
        connected: false,
        message: T.status.paused(parisTime(this.pause.untilWall), this.pause.why),
      };
    }
    if (this.lastIssue) return { connected: false, message: T.status[this.lastIssue] };
    const message = { ...T.status.ready(c.maxPerHour) };
    for (const extra of [
      c.issues.includes('bad_recipients') && T.status.bad_recipients,
      this.dataState === 'unreadable' && T.status.data_unreadable,
    ]) {
      if (!extra) continue;
      message.en += extra.en;
      message.fr += extra.fr;
    }
    return { connected: true, message };
  }

  /** One status at a time, the same one never twice, bounded in time. */
  publishStatus(state = this.currentStatus()) {
    if (!state || !this.running) return;
    const gen = this.generation;
    this.statusJob = this.statusJob.then(async () => {
      if (gen !== this.generation) return;
      const key = JSON.stringify(state);
      if (key === this.lastStatus) return;
      let timer;
      const late = new Promise((resolve) => {
        timer = this.timers.setTimeout(() => resolve('timeout'), STATUS_TIMEOUT);
      });
      try {
        const sent = Promise.resolve(
          this.gladys.setConnectionStatus(state.connected, state.message),
        );
        sent.catch(() => {});
        if ((await Promise.race([sent.then(() => 'ok'), late])) === 'ok') this.lastStatus = key;
        else this.logger.warn('Status not published in time');
      } catch (err) {
        this.logger.warn(`Status not published: ${err?.message ?? err}`);
      } finally {
        this.timers.clearTimeout(timer);
      }
    });
  }
}
