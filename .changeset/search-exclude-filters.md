---
"igdb-kit": minor
---

`searchAll()` searches games, characters, collections, platforms and themes at once and returns typed hits narrowed by kind, with mods and editions left out and a ranking by name match (IGDB returns the newest entries first). `exclude()` leaves selected fields out of the response and its type, nested ones included. On `games`, `where` gains `developedBy()`, `publishedBy()` and `releasedIn()`, which rely on IGDB matching every condition on one array of relations against the same entry. New reference constants: `ReleaseDateStatus`, `Region`, `Language`, `AgeRatingCategory` (`PEGI_18`, `ESRB_M`…), `CompanyStatus`, `CompanySize`, `CompanyType`, `NetworkType`, `CollectionType`, `CollectionMembershipType`, `CollectionRelationType`, `PlatformFamily` and `ImageType`.
