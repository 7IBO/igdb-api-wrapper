---
"igdb-kit": patch
---

`sync()` takes far fewer requests. The first page goes out with the count, and id ranges are sized from the share of ids that match instead of covering 500 ids each: a day of changes on `games` (about 30,000) takes 12 requests and 5 seconds instead of 87 and 22, and all 73,000 companies with `*` about 30 requests instead of 90. A range holding more than a page is read on ahead, packed with the other requests. At most `concurrency` pages and about 64 MB are requested or waiting at once, where 40 pages of heavy rows could hold several hundred MB.
