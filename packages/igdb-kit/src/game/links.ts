import { WebsiteType } from "../generated/schema";
import { idOf, type Ref, type Requires } from "./select";

/** Fields of `websites` that {@link websiteLinks} reads; `websites.trusted` too when selected. */
export type WebsiteLinkFields = "websites.type" | "websites.url";

interface WebsiteRow {
  type?: Ref | undefined;
  url?: string | undefined;
  trusted?: boolean | undefined;
}

/** A game whose selection lets {@link websiteLinks} work. */
export interface WebsiteLinksInput {
  websites?: readonly WebsiteRow[] | undefined;
}

/** What a website is for, from its `WebsiteType`. */
export type WebsiteKind = "official" | "wiki" | "social" | "store" | "other";

export interface WebsiteLink {
  kind: WebsiteKind;
  /** `WebsiteType` id; `label("website_types", type, locale)` of `igdb-kit/i18n` names it. */
  type: number | null;
  url: string;
  /** `websites.trusted` when selected, else null. IGDB never trusts official sites, wikis and console stores. */
  trusted: boolean | null;
}

export interface WebsiteLinksOptions {
  /** Only these kinds, in this order. Default: all, official site first, then wikis, social networks, stores. */
  kinds?: readonly WebsiteKind[] | undefined;
}

const kindsByType: Record<number, WebsiteKind> = {
  [WebsiteType.OfficialWebsite]: "official",
  [WebsiteType.CommunityWiki]: "wiki",
  [WebsiteType.Wikipedia]: "wiki",
  [WebsiteType.Facebook]: "social",
  [WebsiteType.Twitter]: "social",
  [WebsiteType.Twitch]: "social",
  [WebsiteType.Instagram]: "social",
  [WebsiteType.YouTube]: "social",
  [WebsiteType.Subreddit]: "social",
  [WebsiteType.Discord]: "social",
  [WebsiteType.Bluesky]: "social",
  [WebsiteType.AppStoreIPhone]: "store",
  [WebsiteType.AppStoreIPad]: "store",
  [WebsiteType.GooglePlay]: "store",
  [WebsiteType.Steam]: "store",
  [WebsiteType.Itch]: "store",
  [WebsiteType.Epic]: "store",
  [WebsiteType.GOG]: "store",
  [WebsiteType.Xbox]: "store",
  [WebsiteType.Playstation]: "store",
  [WebsiteType.Nintendo]: "store",
  [WebsiteType.Meta]: "store",
  [WebsiteType.GameJolt]: "store",
};

const allKinds: readonly WebsiteKind[] = ["official", "wiki", "social", "store", "other"];

/**
 * The websites of a game by kind: its official site, wikis (Wikipedia, community wiki), social
 * networks (Discord, X, Bluesky, YouTube, Twitch, Reddit...) and stores, each address once. The
 * kind comes from IGDB's type. `trusted` filters nothing: IGDB never sets it on official sites,
 * community wikis and console stores. A social link with no page (`https://twitter.com/`) is left
 * out. For stores recognized from the address, with product ids and localized pages, use
 * `storeLinks()`.
 *
 * ```ts
 * const game = await igdb.games.select("websites.type", "websites.url").findByIdOrThrow(1942);
 * websiteLinks(game, { kinds: ["official", "social"] });
 * // [{ kind: "official", type: 1, url: "http://www.thewitcher.com", trusted: null }, { kind: "social", type: 4, ... }]
 * ```
 */
export function websiteLinks<G extends object>(
  game: G & Requires<G, WebsiteLinkFields>,
  options: WebsiteLinksOptions = {},
): WebsiteLink[] {
  const kinds = options.kinds ?? allKinds;
  const seen = new Set<string>();
  const links: WebsiteLink[] = [];
  for (const row of (game as WebsiteLinksInput).websites ?? []) {
    const type = idOf(row.type) ?? null;
    const kind = (type === null ? undefined : kindsByType[type]) ?? "other";
    if (!row.url || !kinds.includes(kind)) continue;
    const page = parse(row.url);
    if (!page || (kind === "social" && page.path === "")) continue;
    if (seen.has(page.key)) continue;
    seen.add(page.key);
    links.push({ kind, type, url: row.url, trusted: row.trusted ?? null });
  }
  return links.sort((a, b) => kinds.indexOf(a.kind) - kinds.indexOf(b.kind));
}

/** The address without protocol, `www.` and trailing slash, so that two spellings of one page count once. */
function parse(url: string): { key: string; path: string } | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return undefined;
  const path = `${parsed.pathname}${parsed.search}`.replace(/\/+$/, "");
  return { key: `${parsed.hostname.toLowerCase().replace(/^www\./, "")}${path}`, path };
}

/** Fields of `videos` that {@link videoLinks} reads. */
export type VideoLinkFields = "videos.video_id" | "videos.name";

interface VideoRow {
  video_id?: string | undefined;
  name?: string | undefined;
}

/** A game whose selection lets {@link videoLinks} work. */
export interface VideoLinksInput {
  videos?: readonly VideoRow[] | undefined;
}

/** What a video shows, from its name: 71% of IGDB's videos are trailers, 26% gameplay. */
export type VideoKind = "trailer" | "gameplay" | "teaser" | "intro" | "other";

export interface VideoLink {
  kind: VideoKind;
  /** IGDB's name ("Launch Trailer", "Gameplay Video"), in English; null on 2.4% of videos. */
  name: string | null;
  /** The YouTube id. */
  video_id: string;
  /** `https://www.youtube.com/watch?v=…` */
  url: string;
  /** `https://www.youtube.com/embed/…`, for an `<iframe>`. */
  embedUrl: string;
  /** `https://i.ytimg.com/vi/…/hqdefault.jpg`, 480x360, which every video has. */
  thumbnailUrl: string;
}

// Checked against 5,000 names: "Gameplay Trailer" is a trailer, "Gameplay Demo" gameplay.
const videoKinds: [VideoKind, RegExp][] = [
  ["teaser", /teaser/i],
  ["trailer", /tr[aá]iler|tv spot|bande[- ]annonce/i],
  ["gameplay", /gameplay|walkthrough|playthrough|\bdemo\b/i],
  ["intro", /\bintro|opening/i],
];

/**
 * The videos of a game as YouTube links, in IGDB's order: every `video_id` IGDB has is a YouTube
 * id. `kind` comes from the name: a teaser, a trailer (launch, announcement, gameplay trailers), a
 * gameplay video or demo, an intro, or anything else (developer diaries, interviews).
 *
 * ```ts
 * const game = await igdb.games.select("videos.video_id", "videos.name").findByIdOrThrow(119133);
 * videoLinks(game).find((v) => v.kind === "trailer")?.embedUrl; // "https://www.youtube.com/embed/D1mDo1CEMuE"
 * ```
 */
export function videoLinks<G extends object>(game: G & Requires<G, VideoLinkFields>): VideoLink[] {
  const seen = new Set<string>();
  const links: VideoLink[] = [];
  for (const row of (game as VideoLinksInput).videos ?? []) {
    const id = row.video_id?.trim();
    if (!id || !/^[\w-]{11}$/.test(id) || seen.has(id)) continue;
    seen.add(id);
    const name = row.name?.trim() || null;
    links.push({
      kind: (name && videoKinds.find(([, pattern]) => pattern.test(name))?.[0]) || "other",
      name,
      video_id: id,
      url: `https://www.youtube.com/watch?v=${id}`,
      embedUrl: `https://www.youtube.com/embed/${id}`,
      thumbnailUrl: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    });
  }
  return links;
}
