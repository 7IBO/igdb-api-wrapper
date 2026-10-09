---
"igdb-kit": patch
---

Queries are checked against IGDB's real body limit, 32,000 bytes rather than 32,768, and a `PayloadTooLargeError` now says whether the request body or the response is too large. Every error carries its `endpoint`, and a response that is not JSON (a `proxyUrl` answering with an HTML page) throws an `IGDBError` instead of a `SyntaxError`.
