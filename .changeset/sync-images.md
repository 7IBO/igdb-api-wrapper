---
"igdb-kit": minor
---

`query.sync({ since })` copies an endpoint page by page in id order, fetching large sets as parallel id ranges packed into multiqueries, and only what changed since a date with `since`. `imageUrl(imageId, size, { retina, format })` builds IGDB image URLs from an `image_id` or from the `url` field IGDB returns.
