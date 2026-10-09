import { ImageType } from "../generated/schema";
import { type ArtworkTypeFields, artworkType } from "../images";
import { positive, type Requires, type RequiresIfSelected } from "./select";

interface ImageRow {
  image_id?: string | undefined;
  width?: number | undefined;
  height?: number | undefined;
}

interface ArtworkRow extends ImageRow {
  image_type?: number | { id: number } | undefined;
  artwork_type?: number | { id: number } | undefined;
}

/** A game whose selection lets {@link bestImage} work. */
export interface BestImageInput {
  cover?: ImageRow | undefined;
  artworks?: readonly ArtworkRow[] | undefined;
  screenshots?: readonly ImageRow[] | undefined;
}

/**
 * `cover.image_id`, `artworks.image_id` with the artwork's type, `screenshots.image_id`: each image
 * kind selected needs these fields, and at least one kind must be selected. `width` and `height`
 * give the ratio when selected.
 */
export type BestImageRequires<G> = RequiresIfSelected<G, "cover", "cover.image_id"> &
  RequiresIfSelected<G, "artworks", "artworks.image_id" | `artworks.${ArtworkTypeFields}`> &
  RequiresIfSelected<G, "screenshots", "screenshots.image_id"> &
  ("cover" extends keyof G
    ? unknown
    : "artworks" extends keyof G
      ? unknown
      : "screenshots" extends keyof G
        ? unknown
        : Requires<G, "cover.image_id">);

export interface BestImage {
  /** For `imageUrl()` and `imageSrcSet()`. */
  image_id: string;
  source: "cover" | "artwork" | "screenshot";
  /** `ImageType` id of an artwork, from `artworkType()`; null for a cover or a screenshot. */
  type: number | null;
  /** Of the original image, when selected. */
  width: number | null;
  height: number | null;
  /** `width / height`: 0.75 for most covers, 1.78 for screenshots; null when unknown. */
  ratio: number | null;
}

export interface BestImageOptions {
  /**
   * `"cover"` (default): the box art, else an artwork that is a cover, then key art or another
   * artwork, then a screenshot. `"background"`: a landscape artwork (key art without logo first),
   * then a screenshot, then the cover. Logos, icons and infographics are never picked.
   */
  prefer?: "cover" | "background" | undefined;
}

// Artwork types, best first, for each use.
const coverTypes: readonly number[] = [
  ImageType.MainCover,
  ImageType.AlternativeCover,
  ImageType.SquareCover,
  ImageType.HistoricalCover,
];
const artTypes: readonly (number | null)[] = [
  ImageType.KeyArtWithoutLogo,
  ImageType.KeyArtWithLogo,
  ImageType.Artwork,
  ImageType.HistoricalArtwork,
  ImageType.ConceptArt,
  null,
];
const backgroundTypes: readonly (number | null)[] = [
  ImageType.KeyArtWithoutLogo,
  ImageType.Artwork,
  ImageType.KeyArtWithLogo,
  ImageType.HistoricalArtwork,
  ImageType.ConceptArt,
  null,
];

/**
 * The image to show for a game, with its size: the cover, else an artwork, else a screenshot.
 * 13% of complete games have no cover; 6,669 of them have an artwork and 15,886 screenshots. With
 * `prefer: "background"`, a wide image for a banner. Null when the game has no image at all.
 *
 * ```ts
 * const game = await igdb.games.select("cover.image_id", "cover.width", "cover.height",
 *   "artworks.image_id", "artworks.image_type", "artworks.artwork_type", "artworks.width", "artworks.height",
 *   "screenshots.image_id").findByIdOrThrow(119133);
 * const hero = bestImage(game, { prefer: "background" });
 * imageUrl(hero?.image_id, "1080p"); // the 1920x620 artwork of Elden Ring, not one of its logos
 * ```
 */
export function bestImage<G extends object>(
  game: G & BestImageRequires<G>,
  options: BestImageOptions = {},
): BestImage | null {
  const input = game as BestImageInput;
  const artworks = (input.artworks ?? [])
    .filter((row) => row.image_id)
    .map((row) => ({ row, type: artworkType(row as never) }));
  const cover = input.cover?.image_id ? input.cover : undefined;
  const screenshot = input.screenshots?.find((row) => row.image_id);
  const artwork = (types: readonly (number | null)[], landscape: boolean) => {
    for (const type of types) {
      const found = artworks.find(
        (a) => a.type === type && (!landscape || !((a.row.height ?? 0) > (a.row.width ?? 0))),
      );
      if (found) return found;
    }
    return undefined;
  };

  if (options.prefer === "background") {
    const wide = artwork(backgroundTypes, true);
    if (wide) return image(wide.row, "artwork", wide.type);
    if (screenshot) return image(screenshot, "screenshot", null);
    if (cover) return image(cover, "cover", null);
    const other = artwork([...backgroundTypes, ...coverTypes], false);
    return other ? image(other.row, "artwork", other.type) : null;
  }
  if (cover) return image(cover, "cover", null);
  const art = artwork([...coverTypes, ...artTypes], false);
  if (art) return image(art.row, "artwork", art.type);
  return screenshot ? image(screenshot, "screenshot", null) : null;
}

function image(row: ImageRow, source: BestImage["source"], type: number | null): BestImage {
  const width = positive(row.width) ?? null;
  const height = positive(row.height) ?? null;
  return {
    image_id: row.image_id as string,
    source,
    type,
    width,
    height,
    ratio: width !== null && height !== null ? width / height : null,
  };
}
