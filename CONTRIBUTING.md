# Contributing

igdb-kit is a Bun workspace; the package is in `packages/igdb-kit`.

```sh
bun install
bun run codegen          # regenerate src/generated/schema.ts (--fetch downloads the latest proto and reference tables, with Twitch credentials)
bun run audit            # check every field against the live API (types, unknown fields), with Twitch credentials
bun run test             # unit tests
bun run test:types       # compile-time inference tests
bun run bench:types      # type-checking cost per query on each TypeScript version
TWITCH_CLIENT_ID=… TWITCH_CLIENT_SECRET=… bun run --filter igdb-kit test:integration
REDIS_URL=redis://localhost:6379 bun run --filter igdb-kit test:redis
```

A change that users will notice comes with a changeset (`bunx changeset`), which writes its line in the changelog and sets the next version.
