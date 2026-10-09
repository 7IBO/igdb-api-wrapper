import { describe, expect, test } from "bun:test";
import {
  ExternalGameSource,
  GameType,
  ImageType,
  imageSrcSet,
  ReleaseDateRegion,
  WebsiteType,
} from "../../src";
import {
  bestImage,
  externalId,
  externalIds,
  franchisesOf,
  groupByParent,
  type PlatformVersionsOptions,
  platformVersions,
  relatedGameFields,
  relatedGames,
  videoLinks,
  websiteLinks,
} from "../../src/game";
import {
  eldenRing,
  gta5,
  nintendoSwitch,
  type PlatformWithVersions,
  playstation4,
  witcher3,
  witcher3Goty,
} from "./fixtures/related";

describe("relatedGames()", () => {
  test("every list, empty rather than undefined, and the parent", () => {
    const related = relatedGames(witcher3);
    expect(related.parent).toBeNull();
    expect(related.dlcs).toHaveLength(5);
    expect(related.expansions.map((g) => g.name)).toContain("The Witcher 3: Wild Hunt - Blood and Wine");
    expect(related.bundles.map((g) => g.id)).toContain(119402);
    expect(related.remakes).toEqual([]);
    expect(related.forks).toEqual([]);
    expect(Object.keys(related)).toEqual([
      "parent",
      "dlcs",
      "expansions",
      "standalone_expansions",
      "remakes",
      "remasters",
      "expanded_games",
      "ports",
      "forks",
      "bundles",
    ]);
    expect(relatedGames(gta5).expanded_games.map((g) => g.name)).toEqual(["Grand Theft Auto V Enhanced"]);
    expect(relatedGames(witcher3Goty).parent).toEqual({
      relation: "edition",
      game: { id: 1942, name: "The Witcher 3: Wild Hunt" },
      title: "Game of the Year Edition",
    });
  });

  test("a copy of IGDB's arrays, as ids too", () => {
    const game = {
      id: 1,
      game_type: 0,
      parent_game: undefined,
      version_parent: undefined,
      dlcs: [2, 3],
      expansions: undefined,
      standalone_expansions: undefined,
      remakes: undefined,
      remasters: undefined,
      expanded_games: undefined,
      ports: [4],
      forks: undefined,
      bundles: undefined,
    };
    const related = relatedGames(game);
    expect(related.dlcs).toEqual([2, 3]);
    expect(related.dlcs).not.toBe(game.dlcs);
    expect(related.ports).toEqual([4]);
    expect(related.remasters).toEqual([]);
  });

  test("relatedGameFields() selects ids, or the fields you name on each related game", () => {
    expect(relatedGameFields()).toEqual([
      "game_type",
      "version_title",
      "parent_game",
      "version_parent",
      "dlcs",
      "expansions",
      "standalone_expansions",
      "remakes",
      "remasters",
      "expanded_games",
      "ports",
      "forks",
      "bundles",
    ]);
    const fields = relatedGameFields("name", "cover.image_id");
    expect(fields).toHaveLength(2 + 11 * 2);
    expect(fields).toContain("parent_game.name");
    expect(fields).toContain("bundles.cover.image_id");
    expect(Object.isFrozen(fields)).toBe(true);
  });
});

describe("groupByParent()", () => {
  const game = (id: number, name: string, extra: Record<string, unknown> = {}) => ({
    id,
    name,
    game_type: GameType.MainGame as number,
    parent_game: undefined as number | undefined,
    version_parent: undefined as number | undefined,
    version_title: undefined as string | undefined,
    ...extra,
  });
  const darkSouls = game(2155, "Dark Souls");
  const prepare = game(5000, "Dark Souls: Prepare to Die Edition", {
    version_parent: 2155,
    version_title: "Prepare to Die Edition",
  });
  const switchPort = game(5001, "Dark Souls: Remastered (Switch)", {
    game_type: GameType.Port,
    parent_game: 2155,
  });
  const dlc = game(5002, "Artorias of the Abyss", { game_type: GameType.DLC, parent_game: 2155 });
  const goldOfPort = game(5003, "Port Gold Edition", { version_parent: 5001, version_title: "Gold" });
  const orphan = game(5004, "Elden Ring: Deluxe Edition", {
    version_parent: 119133,
    version_title: "Deluxe",
  });

  test("editions and ports join their original, through each other, in list order", () => {
    const { groups, missingParents } = groupByParent([
      prepare,
      darkSouls,
      switchPort,
      dlc,
      goldOfPort,
      orphan,
    ]);
    expect(groups.map((g) => g.game.name)).toEqual([
      "Dark Souls",
      "Artorias of the Abyss",
      "Elden Ring: Deluxe Edition",
    ]);
    expect(groups[0]?.members.map((m) => [m.relation, m.game.id])).toEqual([
      ["edition", 5000],
      ["port", 5001],
      ["edition", 5003],
    ]);
    expect(missingParents).toEqual([119133]);
  });

  test("relations picks what joins a group; a game comes once", () => {
    const { groups, missingParents } = groupByParent([darkSouls, dlc, dlc, prepare], { relations: ["dlc"] });
    expect(groups.map((g) => [g.game.id, g.members.map((m) => m.game.id)])).toEqual([
      [2155, [5002]],
      [5000, []],
    ]);
    expect(missingParents).toEqual([]);
    expect(groupByParent([prepare], { relations: [] })).toEqual({
      groups: [{ game: prepare, members: [] }],
      missingParents: [],
    });
  });

  test("a cycle keeps the first of its games as the group", () => {
    const a = game(1, "A", { version_parent: 2 });
    const b = game(2, "B", { version_parent: 1 });
    const self = game(3, "C", { version_parent: 3 });
    const { groups } = groupByParent([a, b, self]);
    expect(groups.map((g) => [g.game.id, g.members.map((m) => m.game.id)])).toEqual([
      [1, [2]],
      [3, []],
    ]);
  });

  test("expanded parents and real rows", () => {
    expect(groupByParent([witcher3Goty, witcher3]).groups).toEqual([
      { game: witcher3, members: [{ game: witcher3Goty, relation: "edition" }] },
    ]);
  });
});

describe("franchisesOf()", () => {
  test("franchise, else the only one of franchises", () => {
    expect(franchisesOf(witcher3)).toEqual({ main: { id: 452, name: "The Witcher" }, others: [] });
    const zelda = {
      id: 1,
      franchise: 596,
      franchises: [
        { id: 845, name: "Mario" },
        { id: 596, name: "Zelda" },
      ],
    };
    expect(franchisesOf(zelda)).toEqual({
      main: { id: 596, name: "Zelda" },
      others: [{ id: 845, name: "Mario" }],
    });
    expect(franchisesOf({ id: 1, franchise: undefined, franchises: [1, 2] })).toEqual({
      main: null,
      others: [1, 2],
    });
    expect(franchisesOf({ id: 1, franchise: 3, franchises: undefined })).toEqual({ main: 3, others: [] });
    expect(franchisesOf({ id: 1, franchise: undefined, franchises: undefined })).toEqual({
      main: null,
      others: [],
    });
  });
});

describe("externalIds() and externalId()", () => {
  test("one per product, in IGDB's order, several per source", () => {
    expect(externalId(witcher3, ExternalGameSource.Steam)).toBe("292030");
    expect(externalIds(witcher3, ExternalGameSource.GOG)).toEqual([
      { source: 5, uid: "1207664663", url: expect.any(String) },
      { source: 5, uid: "1207664643", url: expect.any(String) },
    ]);
    expect(externalId(witcher3, ExternalGameSource.EpicGamesStore)).toBeNull();
    // Elden Ring lists one Amazon product twice.
    const rows = eldenRing.external_games ?? [];
    const amazon = externalIds(eldenRing, ExternalGameSource.Amazon);
    expect(amazon.length).toBe(
      new Set(rows.filter((r) => r.external_game_source === 20).map((r) => r.uid)).size,
    );
    expect(amazon.length).toBeLessThan(rows.filter((r) => r.external_game_source === 20).length);
    expect(externalIds(eldenRing).map((e) => e.source)).toContain(ExternalGameSource.Steam);
  });

  test("YouTube ids are channels; rows without a uid or a source are skipped", () => {
    expect(externalIds(witcher3, ExternalGameSource.Youtube)).toEqual([
      {
        source: 10,
        uid: "UCprFOIVpCqQLUMsWBNwt0PQ",
        url: "https://www.youtube.com/channel/UCprFOIVpCqQLUMsWBNwt0PQ",
      },
    ]);
    const game = {
      id: 1,
      external_games: [
        { id: 1, uid: "1", external_game_source: undefined },
        { id: 2, uid: undefined, external_game_source: 1 },
        { id: 3, uid: "10", external_game_source: { id: 1 } },
        { id: 4, uid: "10", external_game_source: 1, url: "https://store.steampowered.com/app/10" },
      ],
    };
    expect(externalIds(game)).toEqual([
      { source: 1, uid: "10", url: "https://store.steampowered.com/app/10" },
    ]);
  });
});

describe("websiteLinks()", () => {
  test("by kind, official first, each address once, untrusted kept", () => {
    const links = websiteLinks(witcher3);
    expect(links[0]).toEqual({ kind: "official", type: 1, url: "http://www.thewitcher.com", trusted: false });
    expect(links.map((l) => l.kind)).toEqual([
      "official",
      ...Array(2).fill("wiki"),
      ...Array(7).fill("social"),
      ...Array(6).fill("store"),
    ]);
    expect(websiteLinks(witcher3, { kinds: ["social"] }).map((l) => l.type)).toContain(WebsiteType.Discord);
    expect(websiteLinks(witcher3, { kinds: ["store", "official"] })[0]?.kind).toBe("store");
  });

  test("social links without a page, duplicates, broken addresses and unknown types", () => {
    // The GOTY edition's Twitter link is https://twitter.com/.
    expect(websiteLinks(witcher3Goty).some((l) => l.type === WebsiteType.Twitter)).toBe(false);
    const game = {
      id: 1,
      websites: [
        { id: 1, type: 1, url: "https://example.com" },
        { id: 2, type: { id: 1 }, url: "https://www.example.com/" },
        { id: 3, type: 99, url: "https://new.example.com/game" },
        { id: 4, type: 5, url: "not a url" },
        { id: 5, type: 5, url: "javascript:alert(1)" },
        { id: 6, type: undefined, url: "https://example.org/x" },
      ],
    };
    expect(websiteLinks(game)).toEqual([
      { kind: "official", type: 1, url: "https://example.com", trusted: null },
      { kind: "other", type: 99, url: "https://new.example.com/game", trusted: null },
      { kind: "other", type: null, url: "https://example.org/x", trusted: null },
    ]);
  });
});

describe("videoLinks()", () => {
  test("YouTube links and a kind from the name", () => {
    const videos = videoLinks(witcher3);
    expect(videos[0]).toEqual({
      kind: "other",
      name: "Developer Diary: Creating the Sound",
      video_id: "yowv6_rspoM",
      url: "https://www.youtube.com/watch?v=yowv6_rspoM",
      embedUrl: "https://www.youtube.com/embed/yowv6_rspoM",
      thumbnailUrl: "https://i.ytimg.com/vi/yowv6_rspoM/hqdefault.jpg",
    });
    const kinds = Object.fromEntries(videos.map((v) => [v.name, v.kind]));
    expect(kinds).toMatchObject({
      "TV Spot": "trailer",
      "Opening Cinematic: The Trail": "intro",
      "The Begining trailer": "trailer",
      "Downwarren Gameplay Video": "gameplay",
      "Debut Gameplay Trailer": "trailer",
      "Gameplay Demo": "gameplay",
      "10th Anniversary Video": "other",
    });
    const game = {
      id: 1,
      videos: [
        { id: 1, video_id: "aaaaaaaaaaa", name: "Teaser Trailer" },
        { id: 2, video_id: "aaaaaaaaaaa", name: "Teaser Trailer" },
        { id: 3, video_id: "not/an/id", name: "Trailer" },
        { id: 4, video_id: "bbbbbbbbbbb", name: undefined },
        { id: 5, video_id: undefined, name: "Trailer" },
        { id: 6, video_id: "ccccccccccc", name: "Game Intro" },
      ],
    };
    expect(videoLinks(game).map((v) => [v.video_id, v.kind, v.name])).toEqual([
      ["aaaaaaaaaaa", "teaser", "Teaser Trailer"],
      ["bbbbbbbbbbb", "other", null],
      ["ccccccccccc", "intro", "Game Intro"],
    ]);
  });
});

describe("bestImage() and imageSrcSet()", () => {
  test("the cover, else an artwork that is a cover, then key art, then a screenshot", () => {
    expect(bestImage(witcher3)).toEqual({
      image_id: "coaarl",
      source: "cover",
      type: null,
      width: 600,
      height: 800,
      ratio: 0.75,
    });
    const artworks = [
      { id: 1, image_id: "logo", image_type: ImageType.GameLogoColor, artwork_type: undefined },
      { id: 2, image_id: "key", image_type: undefined, artwork_type: 3, width: 1000, height: 500 },
      { id: 3, image_id: "alt", image_type: undefined, artwork_type: 9 },
    ];
    const screenshots = [{ id: 4, image_id: "shot", width: 1920, height: 1080 }];
    expect(bestImage({ id: 1, cover: undefined, artworks, screenshots })).toMatchObject({
      image_id: "alt",
      source: "artwork",
      type: ImageType.AlternativeCover,
      ratio: null,
    });
    expect(bestImage({ id: 1, artworks: artworks.slice(0, 2), screenshots })).toMatchObject({
      image_id: "key",
      type: ImageType.KeyArtWithLogo,
      ratio: 2,
    });
    expect(bestImage({ id: 1, artworks: artworks.slice(0, 1), screenshots })).toMatchObject({
      image_id: "shot",
      source: "screenshot",
    });
    expect(bestImage({ id: 1, artworks: artworks.slice(0, 1), screenshots: [] })).toBeNull();
    expect(bestImage({ id: 1, cover: { id: 1, image_id: undefined } })).toBeNull();
  });

  test("background: a landscape artwork, then a screenshot, then the cover", () => {
    // Elden Ring's first artworks are 5981x920 logos.
    expect(bestImage(eldenRing, { prefer: "background" })).toMatchObject({
      source: "artwork",
      type: ImageType.Artwork,
      width: 1920,
      height: 620,
    });
    const portrait = {
      id: 1,
      image_id: "tall",
      image_type: ImageType.KeyArtWithoutLogo,
      artwork_type: undefined,
      width: 500,
      height: 900,
    };
    const cover = { id: 2, image_id: "co", width: 600, height: 800 };
    const screenshots = [{ id: 3, image_id: "shot" }];
    expect(
      bestImage({ id: 1, cover, artworks: [portrait], screenshots }, { prefer: "background" })?.image_id,
    ).toBe("shot");
    expect(bestImage({ id: 1, cover, artworks: [portrait] }, { prefer: "background" })?.image_id).toBe("co");
    expect(bestImage({ id: 1, artworks: [portrait] }, { prefer: "background" })?.image_id).toBe("tall");
  });

  test("imageSrcSet()", () => {
    expect(imageSrcSet("co1wyy", "cover_big")).toBe(
      "https://images.igdb.com/igdb/image/upload/t_cover_big/co1wyy.jpg 1x, https://images.igdb.com/igdb/image/upload/t_cover_big_2x/co1wyy.jpg 2x",
    );
    expect(imageSrcSet("co1wyy", "thumb", { format: "webp" })).toContain("t_thumb_2x/co1wyy.webp 2x");
    expect(imageSrcSet(undefined, "thumb")).toBeUndefined();
  });
});

describe("platformVersions()", () => {
  test("versions earliest first, with the date for the user's region", () => {
    const versions = platformVersions(nintendoSwitch, { locale: "fr-FR" });
    expect(versions.map((v) => [v.version.name, v.release?.year, v.release?.match])).toEqual([
      ["Initial version", 2017, "worldwide"],
      ["Switch Lite", 2019, "worldwide"],
      ["OLED Model", 2021, "worldwide"],
    ]);
    expect(versions[0]?.releases.map((r) => [r.region, r.year])).toEqual([
      [ReleaseDateRegion.Worldwide, 2017],
      [ReleaseDateRegion.Korea, 2017],
      [ReleaseDateRegion.China, 2019],
      [ReleaseDateRegion.Brazil, 2020],
    ]);
    const ps4 = (options: PlatformVersionsOptions) => platformVersions(playstation4, options)[0]?.release;
    expect(ps4({ locale: "en-US" })).toMatchObject({
      match: "exact",
      region: ReleaseDateRegion.NorthAmerica,
      day: 15,
    });
    expect(ps4({ locale: "fr-FR" })).toMatchObject({
      match: "exact",
      region: ReleaseDateRegion.Europe,
      day: 29,
    });
    expect(ps4({ region: ReleaseDateRegion.Japan })).toMatchObject({ match: "other_region", day: 15 });
    expect(ps4({})).toMatchObject({ match: "any_region", month: 11, day: 15 });
  });

  test("versions without dates come last; no versions is an empty list", () => {
    const platform: PlatformWithVersions = {
      id: 1,
      versions: [
        { id: 1, name: "Undated" },
        {
          id: 2,
          name: "Dated",
          platform_version_release_dates: [{ id: 1, date: 0, date_format: 0, release_region: 8 }],
        },
      ],
    };
    expect(platformVersions(platform).map((v) => [v.version.name, v.release?.year ?? null])).toEqual([
      ["Dated", 1970],
      ["Undated", null],
    ]);
    expect(platformVersions({ id: 1 } as PlatformWithVersions)).toEqual([]);
  });
});
