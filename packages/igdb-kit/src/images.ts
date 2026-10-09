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

/**
 * URL of an IGDB image from its `image_id` (covers, screenshots, artworks, logos...). Returns
 * undefined when the id is missing, since IGDB omits empty fields:
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
  const suffix = options.retina ? "_2x" : "";
  return `https://images.igdb.com/igdb/image/upload/t_${size}${suffix}/${imageId}.${options.format ?? "jpg"}`;
}
