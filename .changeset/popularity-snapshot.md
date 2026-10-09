---
"igdb-kit": patch
---

`popularitySnapshot()` without `top` reads every row (about 700,000) in 40 seconds and 145 requests instead of 103 seconds and 305. The types are counted, then each type's pages are read in id order with offsets, all requested at once, two types at a time; the cursor of the largest type no longer sets the pace. Every type was held until the end; three are held at most.
