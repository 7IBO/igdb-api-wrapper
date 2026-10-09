---
"igdb-kit": patch
---

`webhookHandler` checks the `X-Secret` header before reading the body, and stops reading past `maxBodyBytes` (a new option, 1 MB by default) to answer 413. `igdbProxy` calls `authorize` before reading the body, and answers 413 instead of 400 as soon as a body passes its `maxBodyBytes`; the browser client splits its batch on it.
