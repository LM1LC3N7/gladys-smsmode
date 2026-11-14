# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- The scene action "Send an SMS (smsmode)": a text to the numbers given or to
  the default ones (5 at most), through the smsmode REST API; outputs `sent`,
  `not_sent`, `message_ids` and `truncated`.
- The buttons "Check the key and the credit" (no SMS sent) and "Send a test
  SMS".
- An hourly cap of billed SMS (1 to 200, 20 by default), kept in `/data`
  across a restart; a maximum number of SMS per message (1 to 10, the text cut
  beyond); GSM 7-bit or Unicode chosen per text, accents kept or simplified.
- No second try of an SMS that may have left (timeout, cut connection, 5xx);
  one request at a time; a pause after a 429 (Retry-After, 60 s to 6 h) or a
  5xx (60 s, doubled, 6 h at most); a refused key (401) never used again by a
  scene until it changes or a button succeeds.
- French mobiles (overseas included) and international numbers; numbers
  masked in the logs; the key never logged nor kept in `/data`.
- The manifest declares `countries: ["FR"]` (France only), so it needs Gladys
  5.3.0 or later.
- `THIRD_PARTY_NOTICES.md`, shipped in the image with `LICENSE`.

### Changed

- The CI jobs stop after 30 minutes (`timeout-minutes`).
