# Third-party notices

This integration is licensed under the Apache License 2.0 (see `LICENSE`). Its
code is its own: no third-party code is copied or ported.

## smsmode REST API

At run time the integration calls the smsmode REST API:
`https://rest.smsmode.com/sms/v1/messages` to send an SMS and
`https://rest.smsmode.com/commons/v1/organisations` to read the balance, with
the API key of the user's own smsmode account. The request and answer formats
come from the public smsmode documentation (`https://dev.smsmode.com/sms/v1/`
(OpenAPI v1.15) and `https://dev.smsmode.com/commons/v1/` (OpenAPI v1.14), read
on 2026-11-14);
nothing of it is shipped in this repository nor in the Docker image. Using the
API is subject to the smsmode terms of the user's account. "smsmode" is a name
of its owner, used here only to say which service is called.

## Runtime dependency

- `@gladysassistant/integration-sdk` (Apache-2.0), the Gladys SDK.
