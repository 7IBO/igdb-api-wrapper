import { describe, expect, test } from "bun:test";
import {
  AgeRatingOrganization,
  GameReleaseFormat,
  Platform,
  ReleaseDateRegion,
  ReleaseDateStatus,
} from "../../src";
import {
  ageRating,
  ageRatings,
  companies,
  formatPlaytime,
  languages,
  localization,
  localizedName,
  multiplayer,
  parentGame,
  releaseDate,
  releasesByPlatform,
  storeLinks,
  storeOf,
  timeToBeat,
} from "../../src/game";
import * as fixtures from "./fixtures/games";

const { externalRows, releaseRows, timeToBeatRows, untrustedWebsites } = fixtures;

describe("releaseDate()", () => {
  test("the first full release, like IGDB's first_release_date", () => {
    const release = releaseDate(fixtures.witcher3);
    expect(release).toMatchObject({
      precision: "day",
      start: new Date("2015-05-19T00:00:00Z"),
      end: new Date("2015-05-20T00:00:00Z"),
      year: 2015,
      quarter: null,
      month: 5,
      day: 19,
      human: "May 19, 2015",
      status: ReleaseDateStatus.FullRelease,
      region: ReleaseDateRegion.Worldwide,
      match: "any_region",
    });
    expect(release?.start?.getTime()).toBe((fixtures.witcher3.first_release_date ?? 0) * 1000);
    // Deprecated: the stored timestamp and the status id under their old names.
    expect(release?.date).toEqual(new Date("2015-05-19T00:00:00Z"));
    expect(release?.statusId).toBe(ReleaseDateStatus.FullRelease);
  });

  test("full release over an earlier early access", () => {
    // Hades was in early access from December 2018; IGDB's first_release_date is the 1.0.
    expect(releaseDate(fixtures.hades)?.human).toBe("Sep 17, 2020");
    expect(fixtures.hades.first_release_date).toBe(1600300800);
    const early = releaseDate(fixtures.hades, { statuses: [ReleaseDateStatus.EarlyAccess] });
    expect(early).toMatchObject({
      human: "Dec 07, 2018",
      status: ReleaseDateStatus.EarlyAccess,
      platform: Platform.PCMicrosoftWindows,
    });
    // Deprecated: status names.
    expect(releaseDate(fixtures.hades, { statuses: ["early_access"] })).toEqual(early);
  });

  test("full release over advanced access and over compatibility releases", () => {
    expect(releaseDate(fixtures.advancedAccess)?.status).toBe(ReleaseDateStatus.FullRelease);
    expect(releaseDate(fixtures.advancedAccess)?.start?.getTime()).toBe(
      (fixtures.advancedAccess.first_release_date ?? 0) * 1000,
    );
    expect(
      releaseDate(fixtures.advancedAccess, { statuses: [ReleaseDateStatus.AdvancedAccess] })?.status,
    ).toBe(ReleaseDateStatus.AdvancedAccess);
    const release = releaseDate(fixtures.compatibilityRelease);
    expect(release).toMatchObject({ status: ReleaseDateStatus.FullRelease, year: 1998 });
  });

  test("early access when the game has nothing else", () => {
    expect(releaseDate(fixtures.starCitizen)).toMatchObject({
      status: ReleaseDateStatus.EarlyAccess,
      human: "Aug 30, 2013",
    });
  });

  test("a missing status is unknown (null), not excluded", () => {
    expect(releaseDate(fixtures.gta5)).toMatchObject({ status: null, statusId: null, year: 2013 });
    expect(releaseDate(fixtures.gta5, { statuses: [null] })?.year).toBe(2013);
    expect(releaseDate(fixtures.gta5, { statuses: ["unknown"] })?.year).toBe(2013);
    expect(releaseDate(fixtures.gta5, { statuses: [ReleaseDateStatus.FullRelease] })).toBeNull();
  });

  test("one platform", () => {
    expect(releaseDate(fixtures.witcher3, { platform: Platform.NintendoSwitch })?.human).toBe("Jan 28, 2021");
    expect(releaseDate(fixtures.witcher3, { platform: Platform.Wii })).toBeNull();
  });

  test("the requested region over worldwide, worldwide over other regions", () => {
    const switchIn = (region: number) =>
      releaseDate(fixtures.hades, { platform: Platform.NintendoSwitch, region });
    expect(switchIn(ReleaseDateRegion.Europe)).toMatchObject({ human: "Mar 18, 2021", match: "exact" });
    expect(switchIn(ReleaseDateRegion.Japan)).toMatchObject({ human: "Jun 24, 2021", match: "exact" });
    expect(switchIn(ReleaseDateRegion.Australia)).toMatchObject({
      human: "Sep 17, 2020",
      match: "worldwide",
    });
  });

  test("a locale picks the region of its country", () => {
    const switchIn = (locale: string) =>
      releaseDate(fixtures.hades, { platform: Platform.NintendoSwitch, locale });
    expect(switchIn("fr-FR")).toMatchObject({ human: "Mar 18, 2021", match: "exact" });
    expect(switchIn("de_DE")).toMatchObject({ human: "Mar 18, 2021", match: "exact" });
    expect(switchIn("ja-JP")).toMatchObject({ human: "Jun 24, 2021", match: "exact" });
    expect(switchIn("en-AU")).toMatchObject({ human: "Sep 17, 2020", match: "worldwide" });
    // No country, or one IGDB has no region for: no region requested.
    expect(switchIn("fr")).toMatchObject({ human: "Sep 17, 2020", match: "any_region" });
    expect(switchIn("es-MX")).toMatchObject({ match: "any_region" });
    // An explicit region wins over the locale.
    expect(
      releaseDate(fixtures.hades, {
        platform: Platform.NintendoSwitch,
        locale: "fr-FR",
        region: ReleaseDateRegion.Japan,
      }),
    ).toMatchObject({ human: "Jun 24, 2021", match: "exact" });
  });

  test("another region as a last resort, unless fallback is false", () => {
    // Mother 3 was only released in Japan.
    const release = releaseDate(fixtures.mother3, { region: ReleaseDateRegion.Europe });
    expect(release).toMatchObject({ match: "other_region", region: ReleaseDateRegion.Japan, year: 2006 });
    expect(releaseDate(fixtures.mother3, { region: ReleaseDateRegion.Europe, fallback: false })).toBeNull();
  });

  test("TBD and cancelled", () => {
    const release = releaseDate(fixtures.scalebound);
    expect(release).toMatchObject({
      precision: "tbd",
      status: ReleaseDateStatus.Cancelled,
      human: "TBD",
      start: null,
      end: null,
      year: null,
      date: null,
    });
  });

  test("month, quarter and year precision", () => {
    const of = (row: (typeof releaseRows)[keyof typeof releaseRows]) => releaseDate({ release_dates: [row] });
    expect(of(releaseRows.month)).toMatchObject({
      precision: "month",
      start: new Date("2026-10-01T00:00:00Z"),
      end: new Date("2026-11-01T00:00:00Z"),
      year: 2026,
      month: 10,
      day: null,
    });
    expect(of(releaseRows.q4)).toMatchObject({
      precision: "quarter",
      start: new Date("2026-10-01T00:00:00Z"),
      end: new Date("2027-01-01T00:00:00Z"),
      year: 2026,
      quarter: 4,
      month: null,
    });
    expect(of(releaseRows.q1)).toMatchObject({ precision: "quarter", year: 2027, quarter: 1 });
    expect(of(releaseRows.year)).toMatchObject({
      precision: "year",
      start: new Date("2027-01-01T00:00:00Z"),
      end: new Date("2028-01-01T00:00:00Z"),
      year: 2027,
      month: null,
    });
    expect(of(releaseRows.year)?.date).toEqual(new Date("2027-12-31T00:00:00Z"));
    expect(of(releaseRows.oldYear)).toMatchObject({ precision: "year", year: 1993 });
    expect(of(releaseRows.before1970)).toMatchObject({ precision: "year", year: 1947 });
    expect(releaseDate(fixtures.mayaTheBee)).toMatchObject({ precision: "year", human: "1999" });
  });

  test("compares periods by their end: Q1 2027 comes before 2027", () => {
    const game = { release_dates: [releaseRows.year, releaseRows.q1, releaseRows.q4] };
    expect(releaseDate(game)?.human).toBe("Q4 2026");
    expect(releaseDate({ release_dates: [releaseRows.year, releaseRows.q1] })?.human).toBe("Q1 2027");
  });

  test("a precise date wins over the month or year that contains it", () => {
    // Space Quest IV: IGDB's first_release_date is the "1991" rows' timestamp, January 1.
    const spaceQuest4: fixtures.FullGame = {
      id: 31,
      first_release_date: 662688000,
      release_dates: [
        { id: 708, date: 662688000, human: "1991", platform: 14, date_format: 2, release_region: 8 },
        { id: 706, date: 662688000, human: "1991", platform: 13, date_format: 2, release_region: 8 },
        {
          id: 458866,
          date: 668044800,
          human: "Mar 04, 1991",
          platform: 6,
          date_format: 0,
          release_region: 8,
        },
      ],
    };
    expect(releaseDate(spaceQuest4)?.human).toBe("Mar 04, 1991");
  });

  test("no release dates", () => {
    expect(releaseDate({ release_dates: [] })).toBeNull();
    expect(releaseDate({ id: 1 } as { id: number; release_dates?: never[] })).toBeNull();
  });

  test("expanded relations work like ids", () => {
    const row = {
      ...releaseRows.q4,
      platform: { id: 6, name: "PC" },
      status: { id: 6, name: "Full Release" },
    };
    expect(releaseDate({ release_dates: [row] })).toMatchObject({ platform: 6, status: 6, row });
  });

  test("releasesByPlatform() picks one per platform, earliest first", () => {
    const releases = releasesByPlatform(fixtures.witcher3);
    expect(releases.map((r) => [r.platform, r.human])).toEqual([
      [48, "May 19, 2015"],
      [49, "May 19, 2015"],
      [6, "May 19, 2015"],
      [130, "Jan 28, 2021"],
      [167, "Dec 14, 2022"],
      [169, "Dec 14, 2022"],
      [508, "Sep 29, 2026"],
    ]);
    expect(releasesByPlatform(fixtures.scalebound).map((r) => r.precision)).toEqual(["tbd", "tbd"]);
  });
});

describe("companies()", () => {
  test("roles, with several regional publishers", () => {
    const result = companies(fixtures.witcher3);
    expect(result.developers.map((c) => c.name)).toEqual(["CD Projekt RED"]);
    expect(result.publishers.map((c) => c.name)).toEqual([
      "WB Games",
      "cdp.pl",
      "Spike Chunsoft",
      "Bandai Namco Entertainment",
    ]);
    expect(result.porting.map((c) => c.name)).toEqual(["Saber Interactive"]);
    expect(result.supporting.map((c) => c.name)).toEqual(["D3T Limited"]);
  });

  test("a company holding several roles", () => {
    const result = companies(fixtures.genshin);
    expect(result.developers.map((c) => c.id)).toEqual(result.publishers.map((c) => c.id));
  });

  test("a company listed twice appears once per role", () => {
    // Game 4: company 27 has one row as developer and another as publisher.
    const game = {
      involved_companies: [
        { id: 265439, company: 27, developer: true, porting: false, publisher: false, supporting: false },
        { id: 265440, company: 26, developer: false, porting: false, publisher: true, supporting: false },
        { id: 265441, company: 291, developer: false, porting: true, publisher: false, supporting: false },
        { id: 265442, company: 23, developer: false, porting: true, publisher: true, supporting: false },
        { id: 265443, company: 27, developer: false, porting: false, publisher: true, supporting: false },
      ],
    };
    expect(companies(game)).toEqual({
      developers: [27],
      publishers: [26, 23, 27],
      porting: [291, 23],
      supporting: [],
    });
  });

  test("none listed", () => {
    expect(companies(fixtures.mayaTheBee)).toEqual({
      developers: [],
      publishers: [],
      porting: [],
      supporting: [],
    });
  });
});

describe("storeLinks()", () => {
  test("from websites, deduplicated with external_games, with Amazon links built from the id", () => {
    const links = storeLinks(fixtures.witcher3);
    expect(links.map((l) => l.store)).toEqual([
      "epic",
      "steam",
      "gog",
      "xbox",
      "playstation",
      "nintendo",
      "amazon",
      "amazon",
      "amazon",
    ]);
    // GOG has two external_games rows and a website for one product.
    expect(links.find((l) => l.store === "gog")).toMatchObject({
      url: "https://www.gog.com/game/the_witcher_3_wild_hunt",
      trusted: true,
      source: "website",
    });
    // IGDB never trusts Xbox, PlayStation and Nintendo links; they are kept.
    expect(links.find((l) => l.store === "xbox")?.trusted).toBe(false);
    expect(links.filter((l) => l.store === "amazon")).toEqual([
      {
        store: "amazon",
        url: "https://amazon.co.jp/dp/B00T3SPV36",
        trusted: null,
        source: "external_game",
        built: true,
        platform: Platform.PlayStation4,
        countries: [392],
        format: GameReleaseFormat.Physical,
      },
      expect.objectContaining({ url: "https://amazon.com/dp/B00WTI2HV6", platform: Platform.XboxOne }),
      expect.objectContaining({
        url: "https://amazon.com/dp/B00WTI3SGO",
        platform: Platform.PCMicrosoftWindows,
      }),
    ]);
  });

  test("one link per product whatever the URL form", () => {
    // Epic: www.epicgames.com/p/x, store.epicgames.com/en-US/p/x and epicgames.com/store/p/x.
    // Apple: the iPhone and iPad links of one app. Xbox: xbox.com and the Game Pass microsoft.com link.
    expect(storeLinks(fixtures.genshin).map((l) => l.store)).toEqual([
      "apple",
      "epic",
      "google_play",
      "playstation",
      "xbox",
    ]);
    const silksong = storeLinks(fixtures.silksong);
    expect(silksong.filter((l) => l.store === "xbox").map((l) => l.url)).toEqual([
      "https://www.xbox.com/en-US/games/store/hollow-knight-silksong/9N116V0599HB/0010",
    ]);
    expect(silksong.filter((l) => l.store === "steam")).toHaveLength(1);
    // Two PlayStation links: a product (one edition) and a concept page.
    expect(silksong.filter((l) => l.store === "playstation")).toHaveLength(2);
  });

  test("builds verified URLs when external_games has none", () => {
    const links = storeLinks({
      external_games: [
        externalRows.steamWithoutUrl,
        externalRows.androidWithoutUrl,
        externalRows.amazonGermany,
        externalRows.amazonIndia,
      ],
    });
    expect(links.map((l) => [l.url, l.built])).toEqual([
      ["https://store.steampowered.com/app/1338610", true],
      ["https://play.google.com/store/apps/details?id=com.riotgames.league.teamfighttactics", true],
      ["https://amazon.de/dp/B07SV2KNHR", true],
    ]);
  });

  test("ignores links that are not live store pages", () => {
    const links = storeLinks({
      websites: Object.values(untrustedWebsites),
      external_games: [externalRows.xbox360Marketplace, externalRows.utomikApi, externalRows.utomik],
    });
    // The store comes from the address: an Xbox link typed as Epic is an Xbox link.
    expect(links.map((l) => [l.store, l.trusted])).toEqual([
      ["xbox", false],
      ["utomik", null],
    ]);
  });

  test("filters by store", () => {
    expect(storeLinks(fixtures.witcher3, { stores: ["steam", "gog"] }).map((l) => l.store)).toEqual([
      "steam",
      "gog",
    ]);
    expect(storeLinks(fixtures.mayaTheBee)).toEqual([]);
  });

  test("storeOf()", () => {
    expect(storeOf("https://store.steampowered.com/app/292030")).toBe("steam");
    expect(storeOf("https://psytronik.itch.io/im3-c64")).toBe("itch");
    expect(storeOf("https://www.nintendo.co.jp/n08/a3uj/index.html")).toBe("nintendo");
    expect(storeOf("https://www.thewitcher.com")).toBeNull();
    expect(storeOf("not a url")).toBeNull();
  });
});

describe("ageRating()", () => {
  test("label, minimum age, descriptors and synopsis", () => {
    const pegi = ageRating(fixtures.witcher3, AgeRatingOrganization.PEGI);
    expect(pegi).toMatchObject({
      organization: AgeRatingOrganization.PEGI,
      category: 12,
      label: "18",
      minimumAge: 18,
      descriptors: ["Violence", "Bad Language", "Sex"],
    });
    expect(pegi?.synopsis).toStartWith("The content of this game is suitable for persons aged 18 years");
    expect(ageRating(fixtures.witcher3, AgeRatingOrganization.CERO)).toMatchObject({
      label: "Z",
      minimumAge: 18,
    });
    expect(ageRating(fixtures.witcher3, AgeRatingOrganization.ACB)).toMatchObject({
      label: "R 18+",
      minimumAge: 18,
    });
  });

  test("the first organization that rated the game", () => {
    expect(ageRating(fixtures.gta6, [AgeRatingOrganization.PEGI, AgeRatingOrganization.ESRB])).toMatchObject({
      organization: AgeRatingOrganization.ESRB,
      label: "RP",
      minimumAge: null, // rating pending
    });
    expect(ageRating(fixtures.gta6, AgeRatingOrganization.PEGI)).toBeNull();
    expect(ageRating(fixtures.mayaTheBee, AgeRatingOrganization.PEGI)).toBeNull();
  });

  test("the strictest of two ratings from one organization", () => {
    expect(ageRating(fixtures.buriedAlive, AgeRatingOrganization.PEGI)?.label).toBe("18");
    expect(ageRating(fixtures.buriedAlive, AgeRatingOrganization.ESRB)).toMatchObject({
      label: "M",
      descriptors: ["Intense Violence", "Blood"],
    });
    expect(ageRatings(fixtures.buriedAlive).map((r) => `${r.organization}:${r.label}`)).toEqual([
      "4:18",
      "6:12",
      "1:M",
      "7:M",
      "2:18",
    ]);
  });

  test("an expanded rating_category gives the label; an unknown one has no minimum age", () => {
    const game = { age_ratings: [{ id: 1, organization: 2, rating_category: { id: 99, rating: "New" } }] };
    expect(ageRating(game, 2)).toMatchObject({
      category: 99,
      label: "New",
      minimumAge: null,
      descriptors: [],
      synopsis: null,
    });
  });
});

describe("localizedName()", () => {
  test("the localization of the locale's region", () => {
    expect(localizedName(fixtures.witcher3, "ja-JP")).toEqual({
      name: "ウィッチャー3 ワイルドハント",
      source: "localization",
    });
    expect(localizedName(fixtures.witcher3, "ko")).toEqual({
      name: "더 위쳐 3: 와일드 헌트",
      source: "localization",
    });
  });

  test("an alternative name in the locale's language", () => {
    expect(localizedName(fixtures.witcher3, "pl-PL")).toEqual({
      name: "Wiedźmin 3: Dziki Gon",
      source: "alternative_name",
    });
    expect(localizedName(fixtures.witcher3, "ru")?.name).toBe("Ведьмак 3: Дикая охота"); // "Russian Title"
    expect(localizedName(fixtures.witcher3, "cs-CZ")?.name).toBe("Zaklínač 3: Divoký hon");
    expect(localizedName(fixtures.witcher3, "zh-TW")?.name).toBe("巫師3：狂獵");
    expect(localizedName(fixtures.witcher3, "zh-CN")?.name).toBe("巫师3：狂猎");
    expect(localizedName(fixtures.witcher3, "zh-Hant")?.name).toBe("巫師3：狂獵");
  });

  test("skips romanizations and translations", () => {
    // Persona 5 Royal: "Japanese title - romanization" is Latin script; the localization wins anyway.
    expect(localizedName(fixtures.persona5Royal, "ja-JP")?.source).toBe("localization");
    const romanized = {
      name: "Persona 5 Royal",
      alternative_names: fixtures.persona5Royal.alternative_names ?? [],
    };
    expect(localizedName(romanized, "ja-JP")).toEqual({ name: "Persona 5 Royal", source: "name" });
  });

  test("the European localization for a European country", () => {
    expect(localizedName(fixtures.monsterRancher2, "en-GB")).toEqual({
      name: "Monster Rancher",
      source: "localization",
    });
    expect(localizedName(fixtures.monsterRancher2, "en-US")).toEqual({
      name: "Monster Rancher 2",
      source: "name",
    });
    expect(localizedName(fixtures.monsterRancher2, "en")).toEqual({
      name: "Monster Rancher 2",
      source: "name",
    });
  });

  test("a localization without a name falls through", () => {
    // The Witcher 3 has a European localization with a cover but no name.
    expect(localizedName(fixtures.witcher3, "fr-FR")).toEqual({
      name: "The Witcher 3: Wild Hunt",
      source: "name",
    });
    expect(localization(fixtures.witcher3, "fr-FR")).toEqual({
      id: 48892,
      region: { id: 4, identifier: "EU" },
    });
    expect(localization(fixtures.witcher3, "en-US")).toBeNull();
  });

  test("regions given as ids", () => {
    const game = {
      name: "Monster Rancher 2",
      game_localizations: [
        { id: 62079, name: "モンスターファーム２", region: 3 },
        { id: 62080, name: "Monster Rancher", region: 4 },
      ],
    };
    expect(localizedName(game, "ja")?.name).toBe("モンスターファーム２");
    expect(localizedName(game, "de-DE")?.name).toBe("Monster Rancher");
  });

  test("only the name selected", () => {
    expect(localizedName({ id: 1, name: "Pong" }, "ja-JP")).toEqual({ name: "Pong", source: "name" });
    expect(localizedName({ id: 1 } as { id: number; name?: string }, "ja-JP")).toBeNull();
  });
});

describe("languages()", () => {
  test("audio, subtitles and interface per language", () => {
    const result = languages(fixtures.witcher3);
    expect(result).toHaveLength(19);
    const byLocale = Object.fromEntries(result.map((l) => [l.language.locale, l]));
    expect(byLocale["fr-FR"]).toMatchObject({ audio: true, subtitles: true, interface: true });
    expect(byLocale["it-IT"]).toMatchObject({ audio: false, subtitles: true, interface: true });
    expect(byLocale["fr-FR"]?.language.native_name).toBe("Français");
  });

  test("unknown when the game has no data of that kind", () => {
    expect(languages(fixtures.mother3)).toEqual([
      {
        language: { id: 16, native_name: "日本語", locale: "ja-JP" },
        audio: null,
        subtitles: null,
        interface: true,
      },
    ]);
    expect(languages(fixtures.mayaTheBee as { id: number; language_supports?: never[] })).toEqual([]);
  });
});

describe("timeToBeat() and formatPlaytime()", () => {
  test("picks normally, then hastily, then completely", () => {
    expect(timeToBeat(timeToBeatRows.witcher3)).toEqual({ seconds: 254778, kind: "normally", count: 41 });
    expect(timeToBeat(timeToBeatRows.hastilyOnly)).toEqual({ seconds: 154920, kind: "hastily", count: 1 });
    expect(timeToBeat(timeToBeatRows.witcher3, { prefer: ["completely"] })?.seconds).toBe(581483);
    // Deprecated: the kinds as the second argument.
    expect(timeToBeat(timeToBeatRows.witcher3, ["completely"])?.seconds).toBe(581483);
    const row = { hastily: undefined, normally: 3600, completely: undefined, count: undefined };
    expect(timeToBeat(row)).toEqual({ seconds: 3600, kind: "normally", count: null });
    expect(timeToBeat(timeToBeatRows.empty)).toBeNull();
    expect(timeToBeat(null)).toBeNull();
    expect(timeToBeat(undefined)).toBeNull();
  });

  test("keeps IGDB's averages as they are", () => {
    expect(timeToBeat(timeToBeatRows.fortnite, { prefer: ["hastily"] })?.seconds).toBeGreaterThan(
      timeToBeat(timeToBeatRows.fortnite)?.seconds ?? 0,
    );
  });

  test("formats minutes, half hours and hours", () => {
    expect(formatPlaytime(254778, { locale: "en-US" })).toBe("71 hr");
    expect(formatPlaytime(2700, { locale: "en-US" })).toBe("45 min");
    expect(formatPlaytime(9000, { locale: "en-US" })).toBe("2.5 hr");
    expect(formatPlaytime(10, { locale: "en-US" })).toBe("1 min");
    expect(formatPlaytime(3590, { locale: "en-US" })).toBe("1 hr");
    expect(formatPlaytime(254778, { locale: "en-US", unitDisplay: "long" })).toBe("71 hours");
    expect(formatPlaytime(254778, { locale: "fr-FR" })).toMatch(/^71\sh$/); // narrow no-break space
    expect(formatPlaytime(undefined)).toBeNull();
    expect(formatPlaytime(0)).toBeNull();
  });
});

describe("multiplayer()", () => {
  test("per platform, with 0 and missing counts as unknown", () => {
    expect(multiplayer(fixtures.watchDogs)).toEqual([
      {
        platform: Platform.PCMicrosoftWindows,
        onlineMax: null,
        onlineCoop: true,
        onlineCoopMax: 2,
        offlineMax: null,
        offlineCoop: false,
        offlineCoopMax: null,
        lanCoop: false,
        splitscreen: false,
        dropIn: true,
        campaignCoop: false,
      },
      expect.objectContaining({ platform: Platform.XboxOne, onlineMax: 8, onlineCoopMax: null }),
      expect.objectContaining({ platform: null, onlineMax: null, onlineCoop: false }),
    ]);
  });

  test("one platform, else the row for every platform", () => {
    expect(multiplayer(fixtures.watchDogs, Platform.XboxOne)?.onlineMax).toBe(8);
    expect(multiplayer(fixtures.watchDogs, Platform.PlayStation4)?.platform).toBeNull();
    expect(multiplayer(fixtures.pong, Platform.PCMicrosoftWindows)).toMatchObject({ offlineMax: 2 });
    expect(multiplayer(fixtures.witcher3, Platform.PCMicrosoftWindows)).toBeNull();
    expect(multiplayer(fixtures.witcher3)).toEqual([]);
  });
});

describe("parentGame()", () => {
  test("editions", () => {
    expect(parentGame(fixtures.codGhostsGold)).toEqual({
      relation: "edition",
      game: 2033,
      title: "Gold Edition",
    });
    // A bundle (game_type 3) that is also an edition of the main game.
    expect(parentGame(fixtures.witcher3Complete)).toMatchObject({ relation: "edition", game: 1942 });
  });

  test("parent_game, named from game_type", () => {
    expect(parentGame(fixtures.shadowOfTheErdtree)).toEqual({
      relation: "expansion",
      game: { id: 119133, name: "Elden Ring" },
      title: null,
    });
    expect(parentGame(fixtures.persona5Royal)?.relation).toBe("expanded_game");
    expect(parentGame(fixtures.scalebound)?.relation).toBe("remake");
    expect(parentGame({ game_type: 99, parent_game: 1, version_parent: undefined })?.relation).toBe("other");
  });

  test("standalone games", () => {
    expect(parentGame(fixtures.witcher3)).toBeNull();
  });
});
