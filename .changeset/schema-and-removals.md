---
"igdb-kit": minor
---

`removed(ids)` on every endpoint lists the stored ids IGDB no longer has, with the reason and the replacement of a duplicate from IGDB's reports, for local copies kept by `sync()` or webhooks. New `igdb-kit/schema` entry: `endpointSchema(endpoint)` describes every field (type, target endpoint, enum values, description, deprecation) and the fields that point to the endpoint, and `jsonSchema(endpoint)` gives the JSON Schema of a row.
