---
"igdb-kit": minor
---

Webhooks: `igdb.webhooks` registers, lists, tests and removes webhooks, and `ensure()` registers several endpoints at startup (idempotent, reactivates disabled ones). The new `igdb-kit/webhooks` entry point verifies deliveries and types them by endpoint and operation, with `webhookHandler` for fetch-style servers and `parseWebhook` for Express or Fastify.
