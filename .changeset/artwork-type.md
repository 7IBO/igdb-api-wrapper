---
"igdb-kit": patch
---

`artworks.artwork_type` is back in the types and accepted in queries, marked deprecated. IGDB replaced it with `image_type` but fills `image_type` on 51% of artworks and `artwork_type` on 99.5%, so following the error igdb-kit threw lost the type of half the artworks. The new `artworkType()` returns an artwork's `ImageType`: its `image_type`, else its `artwork_type` converted, since the two tables number some types differently (8 is "Infographic" in `artwork_types` and "Main cover" in `image_types`, 9 and 10 are swapped, 12 to 15 are one apart). `ArtworkType` holds the ids of `artwork_types`.
