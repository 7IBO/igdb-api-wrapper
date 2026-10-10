# Keeping a local copy

IGDB encourages keeping your own copy of its data.

- [`sync()`](#copying-an-endpoint-sync) copies an endpoint, then only what changed since the last run.
- [Webhooks](#webhooks) push every change between runs.
- [`removed()`](#deletions-removed) finds the rows deleted while you were not listening.
- [`igdb-kit/schema`](#the-schema-igdb-kitschema) describes every table, to create yours.

## Copying an endpoint: sync

`sync()` reads every match page by page, in id order:

```ts
const startedAt = new Date();
for await (const page of igdb.games.select("*").sync({ since: lastSync })) {
  await db.upsertGames(page); // up to 500 games
}
lastSync = startedAt; // next time, only what changed since this run
```

With `since` (a `Date`, a date string or Unix seconds), only entities whose `updated_at` is newer come back. Sync requests run at `background` priority, so interactive queries pass first. Pair it with webhooks to stay up to date between runs.

How it reads:

- The first page goes out with the count. The other pages are then requested in parallel, which batching packs into multiqueries: each asks for the matches after a row already read, skipping those the pages in between hold, so pages come back full however the ids are spread.
- Matches added or removed meanwhile shift the pages: repeated rows are dropped and rows a page skipped past are read again, so none is missed.
- At most `concurrency` pages (40 by default, about 64 MB) are requested or waiting to be read, so a slow consumer does not fill the memory.

A day of changes on `games` (about 33,000) takes 8 requests and 3 seconds, all 73,000 companies with `*` 26 requests and about 11 seconds, and the 133,000 rows of one popularity type, crowded into a few stretches of ids, 28 requests and 7 seconds.

## Webhooks

IGDB can POST every created, updated or deleted entity to your server. Register at startup: it is idempotent, and it reactivates webhooks IGDB turned off after 5 failed deliveries.

```ts
await igdb.webhooks.ensure({
  url: "https://example.com/igdb",
  secret: process.env.IGDB_WEBHOOK_SECRET!,
  endpoints: ["games", "platforms"], // create, update and delete for each
});
```

Then handle deliveries. `webhookHandler` checks the `X-Secret` header and types each event by endpoint and operation:

```ts
import { webhookHandler } from "igdb-kit/webhooks";

const handler = webhookHandler<"games" | "platforms">({
  secret: process.env.IGDB_WEBHOOK_SECRET!,
  onEvent: async (event) => {
    if (event.operation === "delete") return db.remove(event.endpoint, event.data.id);
    if (event.endpoint === "games") await db.saveGame(event.data); // every field, relations as ids
  },
});

Bun.serve({ routes: { "/igdb": { POST: handler } } }); // or Hono: app.post("/igdb", (c) => handler(c.req.raw))
```

It checks the secret before reading the body, and answers 401 when it is wrong, 413 on a body above `maxBodyBytes` (1 MB by default), and 500 when `onEvent` throws, so IGDB retries. With Express, use `parseWebhook({ headers: req.headers, body: req.body, url: req.url }, secret)`. `igdb.webhooks` also has `register`, `list`, `get`, `delete` and `test`.

## Deletions: removed()

`sync({ since })` and webhooks miss rows deleted while you were not listening. `removed(ids)` checks stored ids against IGDB, 500 per query, and gives the reason and the replacement of a duplicate from IGDB's reports (games, companies and game localizations; most deletions have no report):

```ts
const gone = await igdb.games.removed(storedIds);
// [{ id: 422306, reason: "Duplicate", replacement: 399156 }, { id: 202354, reason: "Invalid", replacement: null }]
```

## The schema: igdb-kit/schema

`igdb-kit/schema` describes every endpoint as data, with no request, to generate the tables and indexes of a local copy or to declare a tool's input and output:

```ts
import { endpointNames, endpointSchema, jsonSchema } from "igdb-kit/schema";

const games = endpointSchema("games");
games.fields; // [{ name: "id", type: "integer" }, { name: "platforms", type: "relation", array: true, endpoint: "platforms", description }, ...]
games.linkedFrom; // [{ endpoint: "release_dates", field: "game", array: false }, ...]: where a copy needs an index
jsonSchema("games"); // JSON Schema (draft 2020-12) of a row, relations as ids
```

A field's `type` is `string`, `integer`, `number`, `boolean`, `timestamp` (Unix seconds) or `relation` (with its `endpoint`); `array` marks lists, and `values` the names of an integer that holds one of a few values. Fields IGDB replaced are left out, and those it deprecated but still fills are marked `deprecated`.
