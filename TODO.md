# TODO

## Before announcing

- [ ] Test with a real smsmode account: the check button (balance and role of
      a key), a test SMS, a scene with two numbers, a custom sender with and
      without STOP, a 401 with a revoked key, a 402 with no credit.
- [ ] Test on a real Gladys 5.3+: install, status, the scene action and its
      outputs read by the next action, the two buttons.
- [ ] Turn on "Private vulnerability reporting" (SECURITY.md points there).
- [ ] Add the `gladys-assistant-integration` topic to publish in the store
      (after the first release: the store validator needs the GHCR image).
- [ ] Store field left out of the manifest: `keywords` (SMS, smsmode, texto,
      notification, alerte).

## To confirm

- [ ] Whether smsmode answers 402 for an empty credit (not in the v1.15
      documentation nor its status page; handled as "payment required").
- [ ] The length of the STOP mention smsmode appends (12 characters in its
      example; 20 kept by the module).
- [ ] Whether smsmode answers 429 at all, and with a Retry-After (not in the
      OpenAPI file; the module handles both).
- [ ] Whether `messagePartCount` is in the 201 answer (the cap counts it when
      it says more parts than computed here).
- [ ] What `GET /commons/v1/organisations` gives to a key with the "User"
      role: its organisation with `balance.amount`, or a 403 (both handled).
- [ ] How smsmode splits a GSM text whose extension character (€) falls on a
      part boundary (computed here as 153 septets per part).
- [ ] The exact menu of the smsmode customer area where API keys are created
      (the docs say "API section").

## Ideas

- A `communication` channel (send-only, `contact_schema` per user) once the
  core lets a channel refuse the system messages; for now an SMS leaves only
  from the scene action or the test button.
- Scheduled sending (`sentDate`) and delivery reports (needs an inbound
  webhook, Gladys Plus).

## Decisions

- **Version 0.1.0** set once by hand when leaving the template (package, lock
  file, manifest, image tag `ghcr.io/lm1lc3n7/gladys-smsmode:0.1.0`, User-Agent
  in `src/constants.js`); the Release workflow owns it from now on.
- **`type: "provider"`, `gladys_version: ">=5.3.0"`, `countries: ["FR"]`**: a
  scene action and two buttons, no device. Not `type: "communication"`: the
  core sends its system messages (backups, batteries, upgrades) to every
  channel by default, which would send paid SMS without a scene action (lot 23
  rule: no send without a scene action or the test button). SDK ^0.16.0, the
  latest on 2026-11-14.
- **The hourly cap counts billed parts**, per recipient, reserved before the
  request; given back only when smsmode surely did not take the SMS (4xx,
  redirect, DNS, refused connection, TLS). A save of `/data` that fails does
  not stop an alarm SMS: the cap then holds in memory for the run.
- **No retry of a send**, ever: a timeout, a cut connection or a 5xx may have
  left. `refClient` is not an idempotency key in the smsmode documentation.
- **A refused key** is kept as an 8-bit salted HMAC (many keys share a value):
  a new key is always tried; a 1-in-256 collision is lifted by a button.
- **A text too long is cut** to the maximum number of SMS per message rather
  than refused: an alarm SMS still leaves; `truncated` says it.
- **Unreadable `/data`**: sends go on (in-memory cap), the file is never
  overwritten, read again every 10 s, the run's sends merged and saved then.
- **A wall time in the future in `/data`** (a clock set back) counts as now for
  the cap (at most one hour longer), never dropped.
- **A 401 of the account route** (check button, Commons API) is not a refusal
  of the key for sending: only a 401 of `POST /sms/v1/messages` marks it.
- **/data at start**: a send waits for the first read (3 s at most); a read
  slower than that counts as unreadable (status, read again every 10 s, its
  result still applied when it ends, and the run's sends written then).
- **STOP**: 20 units kept for the mention when cutting, and counted in the
  parts and the cap.
- **Scene budget 40 s** of the 60 s timeout (Gladys counts its own connection
  wait, up to 15 s); a recipient needs 16.5 s left (request and two saves).
- **A key changed during the run** lifts the refusal (an 8-bit mark can
  collide); the same key saved again keeps it.
- **402 and 403** set the status but do not block the next send: smsmode
  decides, and a credit top-up needs no action in Gladys.
- **Test numbers in the docs** are fictional (06 12 34 56 78 style).
