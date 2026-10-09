import { idOf, type Ref, type Requires } from "./game/select";

/** Image sizes served by IGDB. */
export type ImageSize =
  | "thumb" // 90x90, thumb crop
  | "micro" // 35x35, thumb crop
  | "cover_small" // 90x128, fit
  | "cover_big" // 264x374, fit
  | "logo_med" // 284x160, fit
  | "screenshot_med" // 569x320, lfill center
  | "screenshot_big" // 889x500, lfill center
  | "screenshot_huge" // 1280x720, lfill center
  | "720p" // 1280x720, fit center
  | "1080p"; // 1920x1080, fit center

export interface ImageUrlOptions {
  /** Twice the pixels, for high-density screens. */
  retina?: boolean | undefined;
  /** Default `jpg`. */
  format?: "jpg" | "png" | "webp" | undefined;
}

/** Matches the `url` field IGDB returns: `//images.igdb.com/igdb/image/upload/t_thumb/co1wyy.jpg`. */
const IGDB_URL = /^(?:https?:)?\/\/images\.igdb\.com\/igdb\/image\/upload\/t_[^/]+\/([^/.]+)\.\w+$/;

/**
 * URL of an IGDB image from its `image_id` (covers, screenshots, artworks, logos...), or from the
 * `url` field IGDB returns (always `t_thumb`, without protocol). Returns undefined when the input is
 * missing, since IGDB omits empty fields:
 * `imageUrl(game.cover?.image_id, "cover_big", { retina: true })`.
 */
export function imageUrl(imageId: string, size?: ImageSize, options?: ImageUrlOptions): string;
export function imageUrl(
  imageId: string | undefined,
  size?: ImageSize,
  options?: ImageUrlOptions,
): string | undefined;
export function imageUrl(
  imageId: string | undefined,
  size: ImageSize = "thumb",
  options: ImageUrlOptions = {},
): string | undefined {
  if (!imageId) return undefined;
  const id = IGDB_URL.exec(imageId)?.[1] ?? imageId;
  if (id.includes("/")) throw new TypeError(`Not an IGDB image id or URL: ${imageId}`);
  const suffix = options.retina ? "_2x" : "";
  return `https://images.igdb.com/igdb/image/upload/t_${size}${suffix}/${id}.${options.format ?? "jpg"}`;
}

/** `image_types` id of each `artwork_types` id: the two tables number some types differently. */
const IMAGE_TYPE_OF_ARTWORK_TYPE: Record<number, number> = {
  1: 1,
  2: 2,
  3: 3,
  4: 4,
  5: 5,
  6: 6,
  7: 7,
  8: 12, // Infographic
  9: 10, // Alternative cover
  10: 9, // Historical cover
  11: 11,
  12: 13, // Icon
  13: 14, // Historical logo
  14: 15, // Historical icon
  15: 16, // Historical artwork
};

/** Fields of `artworks` that {@link artworkType} reads. */
export type ArtworkTypeFields = "image_type" | "artwork_type";

interface ArtworkTypeInput {
  image_type?: Ref | undefined;
  artwork_type?: Ref | undefined;
}

/**
 * The type of an artwork as an `ImageType` id: its `image_type`, else its `artwork_type` converted.
 * IGDB replaced `artwork_type` with `image_type` but fills `image_type` on about half of the artworks
 * and `artwork_type` on nearly all of them, and the two tables number some types differently (8 is
 * "Infographic" in one and "Main cover" in the other). Null when the artwork has neither, or an
 * `artwork_type` added to IGDB after this version: `artworkType(artwork) === ImageType.ConceptArt`.
 */
export function artworkType<A extends object>(artwork: A & Requires<A, ArtworkTypeFields>): number | null {
  const input = artwork as ArtworkTypeInput;
  const image = idOf(input.image_type);
  if (image !== undefined) return image;
  const legacy = idOf(input.artwork_type);
  return (legacy === undefined ? undefined : IMAGE_TYPE_OF_ARTWORK_TYPE[legacy]) ?? null;
}
