---
"igdb-kit": minor
---

`hooks.onRequest` reports every request for logs and metrics (`path`, `status`, `durationMs`, `bytes`, `attempt`, `blocks`, `cached`). `iterate()` and `sync()` throw on a `sort()` other than the id, which they used to drop. A second client with the same client id and other limiter options gets a console warning instead of silently sharing the first limiter. `expand()` rejects keys that hold values (`tags`, `hypes`). `GameVersionFeatureCategoryEnum` and `GameVersionFeatureValueIncludedFeatureEnum` are no longer marked deprecated.
