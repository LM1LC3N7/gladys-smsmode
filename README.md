# smsmode for Gladys Assistant

**Unofficial**, not affiliated with smsmode. Never tested with a real smsmode
account yet: the API format comes from the public smsmode documentation (read on
2026-11-14).

A Gladys Assistant external integration that sends SMS from your scenes through
your own [smsmode](https://www.smsmode.com/) account (France), paid from your
smsmode credit. Send only: nothing is received.

- A scene action, "Send an SMS (smsmode)": a text, the numbers (or the default
  ones), and the outputs `sent`, `not_sent`, `message_ids`, `truncated`.
- Two buttons: "Check the key and the credit" (no SMS) and "Send a test SMS".
- No SMS at any other time. An hourly cap of billed SMS (1 to 200, kept across
  a restart while `/data` reads and writes), never a second try of an SMS that may have left, one request at
  a time, a pause after a 429 or a 5xx, a refused key never used again by a
  scene.
- French mobiles (overseas included) and international numbers with + or 00;
  numbers masked in the logs; GSM 7-bit or Unicode chosen per text, with an
  optional "simplify accents" mode and a maximum number of SMS per message.

API: `https://rest.smsmode.com/sms/v1/messages` (`X-Api-Key`), documented on
[dev.smsmode.com](https://dev.smsmode.com/sms/v1/).

Guides: [English](docs/en.md) · [Français](docs/fr.md).

## Development

```bash
npm install
npm test                 # node --test, virtual clock and a scripted API
npm run lint && npm run format:check
node scripts/mutants.mjs # mutation check of the guards (use memcap)
```

Requires Gladys 5.3.0 or later (`countries`). Licence: Apache-2.0 (`LICENSE`);
notices in `THIRD_PARTY_NOTICES.md`.
