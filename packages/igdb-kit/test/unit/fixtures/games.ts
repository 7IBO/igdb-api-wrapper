// Real IGDB responses (October 2026), trimmed to the rows the tests need. Regenerate by hand.
import type { Game, GameTimeToBeat, SelectResult } from "../../../src";

export type FullGame = SelectResult<Game, Full>;

export type Full =
  | "name"
  | "game_type"
  | "first_release_date"
  | "version_parent"
  | "version_title"
  | "parent_game.name"
  | "release_dates.date"
  | "release_dates.human"
  | "release_dates.date_format"
  | "release_dates.release_region"
  | "release_dates.platform"
  | "release_dates.status"
  | "involved_companies.company.name"
  | "involved_companies.developer"
  | "involved_companies.publisher"
  | "involved_companies.porting"
  | "involved_companies.supporting"
  | "websites.url"
  | "websites.trusted"
  | "external_games.uid"
  | "external_games.url"
  | "external_games.external_game_source"
  | "external_games.platform"
  | "external_games.countries"
  | "external_games.game_release_format"
  | "age_ratings.organization"
  | "age_ratings.rating_category"
  | "age_ratings.synopsis"
  | "age_ratings.rating_content_descriptions.description"
  | "game_localizations.name"
  | "game_localizations.region.identifier"
  | "game_localizations.cover.image_id"
  | "alternative_names.name"
  | "alternative_names.comment"
  | "language_supports.language.locale"
  | "language_supports.language.native_name"
  | "language_supports.language_support_type"
  | "multiplayer_modes.*";

export const witcher3: FullGame = {
  id: 1942,
  age_ratings: [
    { id: 222156, synopsis: "High impact violence and sex", organization: 7, rating_category: 38 },
    {
      id: 32441,
      synopsis:
        "The content of this game is suitable for persons aged 18 years and over only. It contains: Extreme violence - Violence towards defenceless people - Strong language",
      organization: 2,
      rating_category: 12,
      rating_content_descriptions: [
        { id: 50, description: "Violence" },
        { id: 55, description: "Bad Language" },
        { id: 51, description: "Sex" },
      ],
    },
    {
      id: 67455,
      organization: 3,
      rating_category: 17,
      rating_content_descriptions: [{ id: 61, description: "Violence" }],
    },
    {
      id: 78139,
      organization: 6,
      rating_category: 32,
      rating_content_descriptions: [
        { id: 75, description: "Violência (Violence)" },
        { id: 77, description: "Conteúdo Sexual (Sexual Content)" },
        { id: 82, description: "Drogas Lícitas (Legal Drugs)" },
      ],
    },
    { id: 46963, organization: 4, rating_category: 22 },
    {
      id: 78138,
      organization: 5,
      rating_category: 26,
      rating_content_descriptions: [
        { id: 68, description: "Sexuality" },
        { id: 69, description: "Violence" },
        { id: 71, description: "Language" },
        { id: 72, description: "Alcohol, Tobacco, Drug" },
      ],
    },
    {
      id: 187952,
      organization: 1,
      rating_category: 6,
      rating_content_descriptions: [
        { id: 21, description: "Strong Language" },
        { id: 23, description: "Strong Sexual Content" },
        { id: 4, description: "Blood and Gore" },
        { id: 10, description: "Intense Violence" },
        { id: 26, description: "Use of Alcohol" },
        { id: 14, description: "Nudity" },
      ],
    },
  ],
  alternative_names: [
    { id: 173745, comment: "Alternative title", name: "Witcher III" },
    { id: 2427, comment: "Russian Title", name: "Ведьмак 3: Дикая охота" },
    { id: 2495, comment: "Polish title", name: "Wiedźmin 3: Dziki Gon" },
    { id: 71879, comment: "Chinese title - simplified", name: "巫师3：狂猎" },
    { id: 51941, comment: "Alternative spelling", name: "The Witcher III: Wild Hunt" },
    { id: 74560, comment: "Alternative title", name: "Witcher 3" },
    { id: 74561, comment: "Acronym", name: "TW3" },
    { id: 121895, comment: "Chinese title - traditional", name: "巫師3：狂獵" },
    { id: 179756, comment: "Windows Executable", name: "redprelauncher.exe" },
    { id: 256031, comment: "Czech title", name: "Zaklínač 3: Divoký hon" },
    { id: 276816, comment: "Alternative title", name: "Вещерът 3 - Дивият лов" },
    { id: 282455, comment: "Japanese title - stylized", name: "ウィッチャー３　ワイルドハント" },
    { id: 276919, comment: "Alternative title", name: "Вещерът 3: Дивият лов" },
  ],
  external_games: [
    {
      id: 1935171,
      uid: "B00T3SPV36",
      platform: 48,
      countries: [392],
      external_game_source: 20,
      game_release_format: 2,
    },
    {
      id: 189745,
      uid: "UCprFOIVpCqQLUMsWBNwt0PQ",
      url: "https://gaming.youtube.com/game/UCprFOIVpCqQLUMsWBNwt0PQ",
      external_game_source: 10,
    },
    {
      id: 1934807,
      uid: "B00WTI2HV6",
      platform: 49,
      countries: [840],
      external_game_source: 20,
      game_release_format: 2,
    },
    { id: 11306, uid: "292030", url: "https://store.steampowered.com/app/292030", external_game_source: 1 },
    {
      id: 1931970,
      uid: "B00WTI3SGO",
      platform: 6,
      countries: [840],
      external_game_source: 20,
      game_release_format: 2,
    },
    { id: 119254, uid: "41484", url: "https://www.giantbomb.com/games/3030-41484/", external_game_source: 3 },
    {
      id: 211029,
      uid: "BR765873CQJD",
      url: "https://www.xbox.com/en-us/games/store/the-witcher-3-wild-hunt/BR765873CQJD",
      external_game_source: 11,
    },
    {
      id: 78478,
      uid: "1207664663",
      url: "https://www.gog.com/en/game/the_witcher_3_wild_hunt",
      external_game_source: 5,
    },
    {
      id: 2067884,
      uid: "1207664643",
      url: "https://www.gog.com/en/game/the_witcher_3_wild_hunt",
      external_game_source: 5,
    },
    {
      id: 246257,
      uid: "115977",
      url: "https://www.twitch.tv/directory/game/The Witcher 3: Wild Hunt",
      external_game_source: 14,
    },
    {
      id: 2176359,
      uid: "204794",
      url: "https://store.playstation.com/en-us/concept/204794",
      external_game_source: 36,
    },
  ],
  first_release_date: 1431993600,
  involved_companies: [
    {
      id: 17436,
      company: { id: 50, name: "WB Games" },
      developer: false,
      porting: false,
      publisher: true,
      supporting: false,
    },
    {
      id: 17769,
      company: { id: 3119, name: "cdp.pl" },
      developer: false,
      porting: false,
      publisher: true,
      supporting: false,
    },
    {
      id: 17771,
      company: { id: 1217, name: "Spike Chunsoft" },
      developer: false,
      porting: false,
      publisher: true,
      supporting: false,
    },
    {
      id: 17768,
      company: { id: 248, name: "Bandai Namco Entertainment" },
      developer: false,
      porting: false,
      publisher: true,
      supporting: false,
    },
    {
      id: 64293,
      company: { id: 5696, name: "D3T Limited" },
      developer: false,
      porting: false,
      publisher: false,
      supporting: true,
    },
    {
      id: 196544,
      company: { id: 946, name: "Saber Interactive" },
      developer: false,
      porting: true,
      publisher: false,
      supporting: false,
    },
    {
      id: 418547,
      company: { id: 908, name: "CD Projekt RED" },
      developer: true,
      porting: false,
      publisher: false,
      supporting: false,
    },
  ],
  name: "The Witcher 3: Wild Hunt",
  release_dates: [
    {
      id: 974208,
      date: 1431993600,
      human: "May 19, 2015",
      platform: 48,
      status: 6,
      date_format: 0,
      release_region: 8,
    },
    {
      id: 974209,
      date: 1670976000,
      human: "Dec 14, 2022",
      platform: 167,
      status: 6,
      date_format: 0,
      release_region: 8,
    },
    {
      id: 974210,
      date: 1431993600,
      human: "May 19, 2015",
      platform: 49,
      status: 6,
      date_format: 0,
      release_region: 8,
    },
    {
      id: 974211,
      date: 1670976000,
      human: "Dec 14, 2022",
      platform: 169,
      status: 6,
      date_format: 0,
      release_region: 8,
    },
    {
      id: 974206,
      date: 1611792000,
      human: "Jan 28, 2021",
      platform: 130,
      status: 6,
      date_format: 0,
      release_region: 8,
    },
    {
      id: 974207,
      date: 1431993600,
      human: "May 19, 2015",
      platform: 6,
      status: 6,
      date_format: 0,
      release_region: 8,
    },
    {
      id: 974212,
      date: 1790640000,
      human: "Sep 29, 2026",
      platform: 508,
      status: 6,
      date_format: 0,
      release_region: 8,
    },
  ],
  websites: [
    { id: 19103, trusted: true, url: "https://www.facebook.com/CDPROJEKTRED" },
    {
      id: 141346,
      trusted: true,
      url: "https://www.epicgames.com/store/en-US/product/the-witcher-3-wild-hunt/home",
    },
    {
      id: 793706,
      trusted: false,
      url: "https://www.xbox.com/en-us/games/store/the-witcher-3-wild-hunt/BR765873CQJD",
    },
    { id: 793707, trusted: false, url: "https://store.playstation.com/en-us/concept/204794" },
    {
      id: 793708,
      trusted: false,
      url: "https://www.nintendo.com/games/detail/the-witcher-3-wild-hunt-switch/",
    },
    { id: 19102, trusted: true, url: "https://en.wikipedia.org/wiki/The_Witcher_3:_Wild_Hunt" },
    { id: 19107, trusted: true, url: "https://store.steampowered.com/app/292030" },
    { id: 66471, trusted: false, url: "http://www.thewitcher.com" },
    { id: 119948, trusted: true, url: "https://www.gog.com/game/the_witcher_3_wild_hunt" },
    { id: 19101, trusted: false, url: "http://witcher.wikia.com/wiki/The_Witcher_3:_Wild_Hunt" },
    { id: 19104, trusted: true, url: "https://twitter.com/witchergame" },
    { id: 78076, trusted: true, url: "https://www.reddit.com/r/witcher" },
    { id: 19105, trusted: true, url: "https://www.instagram.com/cdpred" },
    { id: 19106, trusted: true, url: "https://www.youtube.com/user/WitcherGame" },
    {
      id: 512145,
      trusted: true,
      url: "https://www.twitch.tv/directory/game/The%20Witcher%203:%20Wild%20Hunt",
    },
    { id: 670803, trusted: true, url: "https://discord.gg/thewitcher" },
  ],
  language_supports: [
    { id: 30, language: { id: 19, native_name: "Polski", locale: "pl-PL" }, language_support_type: 1 },
    { id: 52, language: { id: 27, native_name: "Deutsch", locale: "de-DE" }, language_support_type: 2 },
    { id: 25, language: { id: 7, native_name: "English (US)", locale: "en-US" }, language_support_type: 1 },
    { id: 27, language: { id: 12, native_name: "Français", locale: "fr-FR" }, language_support_type: 1 },
    { id: 107, language: { id: 7, native_name: "English (US)", locale: "en-US" }, language_support_type: 3 },
    { id: 108, language: { id: 12, native_name: "Français", locale: "fr-FR" }, language_support_type: 3 },
    { id: 109, language: { id: 15, native_name: "Italiano", locale: "it-IT" }, language_support_type: 3 },
    { id: 110, language: { id: 27, native_name: "Deutsch", locale: "de-DE" }, language_support_type: 3 },
    {
      id: 111,
      language: { id: 9, native_name: "Español (España)", locale: "es-ES" },
      language_support_type: 3,
    },
    { id: 112, language: { id: 1, native_name: "العربية", locale: "ar" }, language_support_type: 3 },
    { id: 113, language: { id: 4, native_name: "čeština", locale: "cs-CZ" }, language_support_type: 3 },
    { id: 114, language: { id: 14, native_name: "Magyar", locale: "hu-HU" }, language_support_type: 3 },
    { id: 115, language: { id: 16, native_name: "日本語", locale: "ja-JP" }, language_support_type: 3 },
    { id: 116, language: { id: 17, native_name: "한국어", locale: "ko-KR" }, language_support_type: 3 },
    { id: 117, language: { id: 19, native_name: "Polski", locale: "pl-PL" }, language_support_type: 3 },
    {
      id: 118,
      language: { id: 21, native_name: "Português (Brasil)", locale: "pt-BR" },
      language_support_type: 3,
    },
    { id: 119, language: { id: 22, native_name: "Русский", locale: "ru-RU" }, language_support_type: 3 },
    { id: 120, language: { id: 3, native_name: "繁體中文", locale: "zh-TW" }, language_support_type: 3 },
    { id: 121, language: { id: 2, native_name: "简体中文", locale: "zh-CN" }, language_support_type: 3 },
    { id: 122, language: { id: 24, native_name: "Türkçe", locale: "tr-TR" }, language_support_type: 3 },
    { id: 32, language: { id: 22, native_name: "Русский", locale: "ru-RU" }, language_support_type: 1 },
    { id: 33, language: { id: 7, native_name: "English (US)", locale: "en-US" }, language_support_type: 2 },
    {
      id: 34,
      language: { id: 9, native_name: "Español (España)", locale: "es-ES" },
      language_support_type: 2,
    },
    { id: 36, language: { id: 15, native_name: "Italiano", locale: "it-IT" }, language_support_type: 2 },
    { id: 35, language: { id: 12, native_name: "Français", locale: "fr-FR" }, language_support_type: 2 },
    { id: 37, language: { id: 14, native_name: "Magyar", locale: "hu-HU" }, language_support_type: 2 },
    { id: 38, language: { id: 19, native_name: "Polski", locale: "pl-PL" }, language_support_type: 2 },
    { id: 39, language: { id: 4, native_name: "čeština", locale: "cs-CZ" }, language_support_type: 2 },
    { id: 40, language: { id: 22, native_name: "Русский", locale: "ru-RU" }, language_support_type: 2 },
    { id: 41, language: { id: 3, native_name: "繁體中文", locale: "zh-TW" }, language_support_type: 2 },
    {
      id: 42,
      language: { id: 21, native_name: "Português (Brasil)", locale: "pt-BR" },
      language_support_type: 1,
    },
    { id: 43, language: { id: 16, native_name: "日本語", locale: "ja-JP" }, language_support_type: 1 },
    {
      id: 44,
      language: { id: 10, native_name: "Español (Mexico)", locale: "es-MX" },
      language_support_type: 2,
    },
    {
      id: 45,
      language: { id: 21, native_name: "Português (Brasil)", locale: "pt-BR" },
      language_support_type: 2,
    },
    { id: 46, language: { id: 24, native_name: "Türkçe", locale: "tr-TR" }, language_support_type: 2 },
    { id: 47, language: { id: 1, native_name: "العربية", locale: "ar" }, language_support_type: 2 },
    { id: 48, language: { id: 2, native_name: "简体中文", locale: "zh-CN" }, language_support_type: 2 },
    { id: 49, language: { id: 16, native_name: "日本語", locale: "ja-JP" }, language_support_type: 2 },
    { id: 50, language: { id: 17, native_name: "한국어", locale: "ko-KR" }, language_support_type: 2 },
    { id: 51, language: { id: 27, native_name: "Deutsch", locale: "de-DE" }, language_support_type: 1 },
    {
      id: 157788,
      language: { id: 8, native_name: "English (UK)", locale: "en-GB" },
      language_support_type: 3,
    },
    {
      id: 157790,
      language: { id: 8, native_name: "English (UK)", locale: "en-GB" },
      language_support_type: 2,
    },
    {
      id: 157789,
      language: { id: 8, native_name: "English (UK)", locale: "en-GB" },
      language_support_type: 1,
    },
    {
      id: 157793,
      language: { id: 10, native_name: "Español (Mexico)", locale: "es-MX" },
      language_support_type: 3,
    },
    { id: 809055, language: { id: 2, native_name: "简体中文", locale: "zh-CN" }, language_support_type: 1 },
    { id: 1236427, language: { id: 17, native_name: "한국어", locale: "ko-KR" }, language_support_type: 1 },
    {
      id: 1785321,
      language: { id: 28, native_name: "українська", locale: "uk-UA" },
      language_support_type: 3,
    },
    {
      id: 1785322,
      language: { id: 28, native_name: "українська", locale: "uk-UA" },
      language_support_type: 2,
    },
  ],
  game_localizations: [
    { id: 181, name: "ウィッチャー3 ワイルドハント", region: { id: 3, identifier: "ja-JP" } },
    { id: 182, name: "더 위쳐 3: 와일드 헌트", region: { id: 2, identifier: "ko-KR" } },
    { id: 48892, region: { id: 4, identifier: "EU" } },
  ],
  game_type: 0,
};

export const hades: FullGame = {
  id: 113112,
  first_release_date: 1600300800,
  name: "Hades",
  release_dates: [
    {
      id: 465216,
      date: 1600300800,
      human: "Sep 17, 2020",
      platform: 6,
      status: 6,
      date_format: 0,
      release_region: 8,
    },
    {
      id: 482856,
      date: 1628812800,
      human: "Aug 13, 2021",
      platform: 167,
      status: 6,
      date_format: 0,
      release_region: 8,
    },
    {
      id: 482857,
      date: 1628812800,
      human: "Aug 13, 2021",
      platform: 49,
      status: 6,
      date_format: 0,
      release_region: 8,
    },
    {
      id: 482858,
      date: 1628812800,
      human: "Aug 13, 2021",
      platform: 169,
      status: 6,
      date_format: 0,
      release_region: 8,
    },
    {
      id: 575593,
      date: 1710806400,
      human: "Mar 19, 2024",
      platform: 39,
      status: 6,
      date_format: 0,
      release_region: 8,
    },
    {
      id: 482849,
      date: 1600300800,
      human: "Sep 17, 2020",
      platform: 14,
      status: 6,
      date_format: 0,
      release_region: 8,
    },
    {
      id: 482850,
      date: 1624492800,
      human: "Jun 24, 2021",
      platform: 130,
      status: 6,
      date_format: 0,
      release_region: 5,
    },
    {
      id: 482855,
      date: 1628812800,
      human: "Aug 13, 2021",
      platform: 48,
      status: 6,
      date_format: 0,
      release_region: 8,
    },
    {
      id: 482848,
      date: 1575936000,
      human: "Dec 10, 2019",
      platform: 14,
      status: 3,
      date_format: 0,
      release_region: 8,
    },
    {
      id: 482851,
      date: 1600300800,
      human: "Sep 17, 2020",
      platform: 130,
      status: 6,
      date_format: 0,
      release_region: 2,
    },
    {
      id: 482852,
      date: 1616025600,
      human: "Mar 18, 2021",
      platform: 130,
      status: 6,
      date_format: 0,
      release_region: 1,
    },
    {
      id: 482853,
      date: 1600300800,
      human: "Sep 17, 2020",
      platform: 130,
      status: 6,
      date_format: 0,
      release_region: 8,
    },
    {
      id: 482854,
      date: 1544140800,
      human: "Dec 07, 2018",
      platform: 6,
      status: 3,
      date_format: 0,
      release_region: 8,
    },
  ],
};

export const mother3: FullGame = {
  id: 3683,
  alternative_names: [
    { id: 62482, comment: "Alternative title", name: "EarthBound 2" },
    { id: 74908, comment: "Stylized title", name: "MOTHER 3" },
    { id: 125332, comment: "Alternative spelling", name: "マザー3" },
    { id: 137927, comment: "Korean title - alternative", name: "어스바운드 2" },
  ],
  external_games: [
    { id: 153498, uid: "3864", url: "https://www.giantbomb.com/games/3030-3864/", external_game_source: 3 },
    {
      id: 1931443,
      uid: "B019C583KW",
      platform: 41,
      countries: [392],
      external_game_source: 20,
      game_release_format: 1,
    },
    {
      id: 2116874,
      uid: "2124779413",
      url: "https://www.twitch.tv/directory/game/MOTHER%203",
      external_game_source: 14,
    },
  ],
  name: "Mother 3",
  release_dates: [
    {
      id: 545539,
      date: 1450310400,
      human: "Dec 17, 2015",
      platform: 41,
      status: 6,
      date_format: 0,
      release_region: 5,
    },
    {
      id: 545538,
      date: 1145491200,
      human: "Apr 20, 2006",
      platform: 24,
      status: 6,
      date_format: 0,
      release_region: 5,
    },
  ],
  language_supports: [
    { id: 636367, language: { id: 16, native_name: "日本語", locale: "ja-JP" }, language_support_type: 3 },
  ],
  game_localizations: [{ id: 3673, name: "マザースリー", region: { id: 3, identifier: "ja-JP" } }],
};

export const scalebound: FullGame = {
  id: 7345,
  name: "Scalebound",
  parent_game: { id: 264882, name: "Scalebound" },
  release_dates: [
    { id: 473970, human: "TBD", platform: 6, status: 5, date_format: 7, release_region: 8 },
    { id: 473971, human: "TBD", platform: 49, status: 5, date_format: 7, release_region: 8 },
  ],
  game_type: 8,
};

export const mayaTheBee: FullGame = {
  id: 50000,
  name: "Maya the Bee & Her Friends",
  release_dates: [
    { id: 385948, date: 946598400, human: "1999", platform: 22, date_format: 2, release_region: 1 },
  ],
};

export const silksong: FullGame = {
  id: 115289,
  external_games: [
    {
      id: 1746551,
      uid: "72161",
      url: "https://www.giantbomb.com/games/3030-72161/",
      external_game_source: 3,
    },
    {
      id: 1706405,
      uid: "1030300",
      url: "https://store.steampowered.com/app/1030300",
      external_game_source: 1,
    },
    {
      id: 3118557,
      uid: "9N116V0599HB",
      url: "https://www.microsoft.com/en-us/p/-1-/9N116V0599HB",
      external_game_source: 54,
    },
    {
      id: 2070412,
      uid: "1558393671",
      url: "https://www.gog.com/en/game/hollow_knight_silksong",
      external_game_source: 5,
    },
    {
      id: 3096993,
      uid: "amzn1.adg.product.18415745-caeb-4d93-8a8b-04c111b6dfe3",
      url: "https://play.amazon.com/play?gid=amzn1.adg.product.18415745-caeb-4d93-8a8b-04c111b6dfe3&territory=US&r=web&ref=igdb",
      external_game_source: 23,
    },
    {
      id: 1913032,
      uid: "511391",
      url: "https://www.twitch.tv/directory/game/Hollow%20Knight%3A%20Silksong",
      external_game_source: 14,
    },
    {
      id: 3097780,
      uid: "10005908",
      url: "https://store.playstation.com/en-us/concept/10005908",
      external_game_source: 36,
    },
  ],
  name: "Hollow Knight: Silksong",
  websites: [
    { id: 855311, trusted: true, url: "https://www.twitch.tv/directory/category/hollow-knight-silksong" },
    {
      id: 868175,
      trusted: false,
      url: "https://www.xbox.com/en-US/games/store/hollow-knight-silksong/9N116V0599HB/0010",
    },
    {
      id: 868176,
      trusted: false,
      url: "https://store.playstation.com/en-us/product/EP1805-PPSA12544_00-HKSILKSONGPS5000",
    },
    {
      id: 868177,
      trusted: false,
      url: "https://www.nintendo.com/us/store/products/hollow-knight-silksong-switch",
    },
    { id: 868179, trusted: true, url: "https://bsky.app/profile/teamcherry.bsky.social" },
    { id: 868178, trusted: true, url: "https://en.wikipedia.org/wiki/Hollow_Knight:_Silksong" },
    { id: 104449, trusted: true, url: "https://www.youtube.com/teamcherrygames" },
    { id: 259657, trusted: true, url: "https://www.facebook.com/teamcherrygames" },
    { id: 597736, trusted: false, url: "https://hollowknight.wiki/w/Hollow_Knight:_Silksong" },
    { id: 871651, trusted: true, url: "https://www.reddit.com/r/Silksong/top" },
    { id: 100095, trusted: true, url: "https://twitter.com/TeamCherryGames" },
    { id: 120593, trusted: true, url: "https://www.gog.com/game/hollow_knight_silksong" },
    { id: 100094, trusted: false, url: "http://hollowknightsilksong.com/" },
    { id: 100112, trusted: true, url: "https://store.steampowered.com/app/1030300/Hollow_Knight_Silksong/" },
  ],
};

export const genshin: FullGame = {
  id: 119277,
  external_games: [
    {
      id: 1776078,
      uid: "73982",
      url: "https://www.giantbomb.com/games/3030-73982/",
      external_game_source: 3,
    },
    {
      id: 2963459,
      uid: "9N7TFFRRZCC9",
      url: "https://www.microsoft.com/en-us/p/-1-/9N7TFFRRZCC9",
      external_game_source: 54,
    },
    {
      id: 2963543,
      uid: "9N7TFFRRZCC9",
      url: "https://www.xbox.com/en-us/games/store/genshin-impact/9N7TFFRRZCC9",
      external_game_source: 11,
    },
    {
      id: 2625786,
      uid: "acc319019e974ec9a4af28530141d888",
      url: "https://store.epicgames.com/en-US/p/genshin-impact",
      external_game_source: 26,
    },
    {
      id: 2118543,
      uid: "4fe53963-dbd9-4797-b8cc-f4ba4a0de1b1",
      url: "https://www.epicgames.com/store/p/genshin-impact",
      external_game_source: 26,
    },
    {
      id: 2172451,
      uid: "10000896",
      url: "https://store.playstation.com/en-us/concept/10000896",
      external_game_source: 36,
    },
    {
      id: 1914702,
      uid: "513181",
      url: "https://www.twitch.tv/directory/game/Genshin%20Impact",
      external_game_source: 14,
    },
  ],
  involved_companies: [
    {
      id: 176184,
      company: { id: 41907, name: "HoYoverse" },
      developer: true,
      porting: false,
      publisher: true,
      supporting: false,
    },
    {
      id: 193586,
      company: { id: 40242, name: "Cognosphere" },
      developer: true,
      porting: false,
      publisher: true,
      supporting: false,
    },
    {
      id: 231330,
      company: { id: 15932, name: "miHoYo" },
      developer: true,
      porting: false,
      publisher: true,
      supporting: false,
    },
  ],
  name: "Genshin Impact",
  websites: [
    { id: 154961, trusted: true, url: "https://apps.apple.com/app/id1517783697" },
    { id: 184465, trusted: true, url: "https://www.epicgames.com/p/genshin-impact" },
    { id: 913385, trusted: true, url: "https://discord.gg/genshinimpact" },
    { id: 913383, trusted: true, url: "https://x.com/GenshinImpact" },
    { id: 913384, trusted: true, url: "https://www.youtube.com/@GenshinImpact" },
    { id: 809259, trusted: false, url: "https://store.playstation.com/en-us/concept/10000896" },
    { id: 809258, trusted: false, url: "https://www.xbox.com/en-us/games/store/genshin-impact/9N7TFFRRZCC9" },
    { id: 108186, trusted: true, url: "https://www.instagram.com/genshinimpact" },
    { id: 125675, trusted: true, url: "https://en.wikipedia.org/wiki/Genshin_Impact" },
    { id: 125699, trusted: true, url: "https://www.reddit.com/r/Genshin_Impact" },
    { id: 290620, trusted: true, url: "https://itunes.apple.com/us/app/id1517783697" },
    { id: 518895, trusted: true, url: "https://www.twitch.tv/genshinimpactofficial" },
    { id: 582104, trusted: false, url: "https://genshin.hoyoverse.com/" },
    { id: 108184, trusted: true, url: "https://www.facebook.com/Genshinimpact" },
    {
      id: 154960,
      trusted: true,
      url: "https://play.google.com/store/apps/details?id=com.miHoYo.GenshinImpact",
    },
    { id: 154963, trusted: false, url: "https://genshin-impact.fandom.com/wiki/Genshin_Impact_Wiki" },
  ],
};

export const starCitizen: FullGame = {
  id: 1595,
  name: "Star Citizen",
  release_dates: [
    {
      id: 664155,
      date: 1377820800,
      human: "Aug 30, 2013",
      platform: 6,
      status: 3,
      date_format: 0,
      release_region: 8,
    },
  ],
};

export const gta5: FullGame = {
  id: 1020,
  multiplayer_modes: [
    {
      id: 1045,
      campaigncoop: false,
      dropin: true,
      lancoop: false,
      offlinecoop: false,
      offlinecoopmax: 0,
      offlinemax: 0,
      onlinecoop: true,
      onlinecoopmax: 16,
      onlinemax: 0,
      platform: 9,
      splitscreen: false,
    },
    {
      id: 12794,
      campaigncoop: false,
      dropin: false,
      lancoop: false,
      offlinecoop: false,
      offlinecoopmax: 0,
      offlinemax: 0,
      onlinecoop: true,
      onlinecoopmax: 0,
      onlinemax: 30,
      platform: 49,
      splitscreen: false,
    },
    {
      id: 12795,
      campaigncoop: false,
      dropin: false,
      lancoop: false,
      offlinecoop: false,
      onlinecoop: true,
      platform: 6,
      splitscreen: false,
    },
  ],
  name: "Grand Theft Auto V",
  release_dates: [
    { id: 20291, date: 1416268800, human: "Nov 18, 2014", platform: 48, date_format: 0, release_region: 8 },
    { id: 403430, date: 1428883200, human: "Apr 13, 2015", platform: 6, date_format: 0, release_region: 8 },
    { id: 20294, date: 1379376000, human: "Sep 17, 2013", platform: 9, date_format: 0, release_region: 8 },
    { id: 20293, date: 1379376000, human: "Sep 17, 2013", platform: 12, date_format: 0, release_region: 8 },
    { id: 20290, date: 1416268800, human: "Nov 18, 2014", platform: 49, date_format: 0, release_region: 8 },
    {
      id: 934896,
      date: 1741996800,
      human: "Mar 15, 2025",
      platform: 169,
      status: 36,
      date_format: 0,
      release_region: 8,
    },
    {
      id: 934897,
      date: 1741996800,
      human: "Mar 15, 2025",
      platform: 167,
      status: 36,
      date_format: 0,
      release_region: 8,
    },
  ],
};

export const persona5Royal: FullGame = {
  id: 114283,
  alternative_names: [
    { id: 24390, comment: "Acronym", name: "P5R" },
    { id: 56060, comment: "Japanese title - romanization", name: "Persona 5 The Royal" },
    { id: 154579, comment: "Chinese title - simplified", name: "女神异闻录5 皇家版" },
    { id: 156605, comment: "Chinese title - traditional", name: "女神異聞錄5 皇家版" },
    { id: 183545, comment: "Windows Executable", name: "P5R.exe" },
  ],
  name: "Persona 5 Royal",
  parent_game: { id: 9927, name: "Persona 5" },
  game_localizations: [
    {
      id: 865,
      name: "페르소나 5 더 로열",
      cover: { id: 494149, image_id: "coalad" },
      region: { id: 2, identifier: "ko-KR" },
    },
    {
      id: 11578,
      name: "ペルソナ 5 ザ・ロイヤル",
      cover: { id: 537893, image_id: "cobj1h" },
      region: { id: 3, identifier: "ja-JP" },
    },
  ],
  game_type: 10,
};

export const codGhostsGold: FullGame = {
  id: 100000,
  name: "Call of Duty: Ghosts - Gold Edition",
  version_parent: 2033,
  version_title: "Gold Edition",
  game_type: 3,
};

export const shadowOfTheErdtree: FullGame = {
  id: 240009,
  name: "Elden Ring: Shadow of the Erdtree",
  parent_game: { id: 119133, name: "Elden Ring" },
  game_type: 2,
};

export const watchDogs: FullGame = {
  id: 1121,
  multiplayer_modes: [
    {
      id: 1074,
      campaigncoop: false,
      dropin: true,
      lancoop: false,
      offlinecoop: false,
      offlinecoopmax: 0,
      offlinemax: 0,
      onlinecoop: true,
      onlinecoopmax: 2,
      onlinemax: 0,
      platform: 6,
      splitscreen: false,
    },
    {
      id: 8335,
      campaigncoop: false,
      dropin: false,
      lancoop: false,
      offlinecoop: false,
      offlinecoopmax: 0,
      offlinemax: 0,
      onlinecoop: true,
      onlinecoopmax: 0,
      onlinemax: 8,
      platform: 49,
      splitscreen: false,
    },
    {
      id: 7443,
      campaigncoop: false,
      dropin: false,
      lancoop: false,
      offlinecoop: false,
      onlinecoop: false,
      splitscreen: false,
    },
  ],
  name: "Watch Dogs",
};

export const pong: FullGame = {
  id: 1333,
  multiplayer_modes: [
    {
      id: 14666,
      campaigncoop: false,
      dropin: false,
      lancoop: false,
      offlinecoop: false,
      offlinemax: 2,
      onlinecoop: false,
      splitscreen: false,
    },
  ],
  name: "Pong",
  release_dates: [
    {
      id: 835675,
      date: 91843200,
      human: "Nov 29, 1972",
      platform: 52,
      status: 6,
      date_format: 0,
      release_region: 2,
    },
    {
      id: 835676,
      date: 126144000,
      human: "1973",
      platform: 52,
      status: 6,
      date_format: 2,
      release_region: 3,
    },
    {
      id: 835681,
      date: 1079049600,
      human: "Mar 12, 2004",
      platform: 6,
      status: 6,
      date_format: 0,
      release_region: 8,
    },
    {
      id: 835679,
      date: 186624000,
      human: "Dec 1975",
      platform: 377,
      status: 6,
      date_format: 1,
      release_region: 2,
    },
    {
      id: 835677,
      date: 144547200,
      human: "Aug 1974",
      platform: 52,
      status: 6,
      date_format: 1,
      release_region: 5,
    },
    {
      id: 835678,
      date: 212976000,
      human: "Oct 1976",
      platform: 52,
      status: 6,
      date_format: 1,
      release_region: 9,
    },
    {
      id: 835680,
      date: 1604966400,
      human: "Nov 10, 2020",
      platform: 55,
      status: 6,
      date_format: 0,
      release_region: 8,
    },
    {
      id: 935134,
      date: 126144000,
      human: "1973",
      platform: 52,
      status: 6,
      date_format: 2,
      release_region: 2,
    },
    {
      id: 935135,
      date: 144547200,
      human: "Aug 1974",
      platform: 52,
      status: 6,
      date_format: 1,
      release_region: 2,
    },
    {
      id: 935136,
      date: 147225600,
      human: "Sep 1974",
      platform: 52,
      status: 6,
      date_format: 1,
      release_region: 2,
    },
    {
      id: 935137,
      date: 220838400,
      human: "1976",
      platform: 377,
      status: 6,
      date_format: 2,
      release_region: 2,
    },
    {
      id: 935138,
      date: 220838400,
      human: "1976",
      platform: 377,
      status: 6,
      date_format: 2,
      release_region: 5,
    },
  ],
};

export const gta6: FullGame = {
  id: 52189,
  age_ratings: [{ id: 210410, organization: 1, rating_category: 1 }],
  name: "Grand Theft Auto VI",
};

export const buriedAlive: FullGame = {
  id: 258999,
  age_ratings: [
    { id: 181841, organization: 4, rating_category: 21 },
    { id: 181704, organization: 6, rating_category: 30 },
    {
      id: 197406,
      organization: 1,
      rating_category: 5,
      rating_content_descriptions: [
        { id: 29, description: "Violence" },
        { id: 3, description: "Blood" },
      ],
    },
    {
      id: 163066,
      organization: 1,
      rating_category: 6,
      rating_content_descriptions: [
        { id: 10, description: "Intense Violence" },
        { id: 3, description: "Blood" },
      ],
    },
    { id: 183054, organization: 7, rating_category: 36 },
    { id: 194837, organization: 2, rating_category: 11 },
    { id: 181705, organization: 4, rating_category: 22 },
    { id: 181703, organization: 2, rating_category: 12 },
  ],
  name: "Buried Alive: Breathless Rescue",
};

export const monsterRancher2: FullGame = {
  id: 4106,
  name: "Monster Rancher 2",
  game_localizations: [
    {
      id: 62079,
      name: "モンスターファーム２",
      cover: { id: 604633, image_id: "cocyjd" },
      region: { id: 3, identifier: "ja-JP" },
    },
    {
      id: 62080,
      name: "Monster Rancher",
      cover: { id: 604634, image_id: "cocyje" },
      region: { id: 4, identifier: "EU" },
    },
  ],
};

export const advancedAccess: FullGame = {
  id: 409868,
  first_release_date: 1779408000,
  name: "LEGO Batman: Legacy of the Dark Knight - The Dark Knight Returns Suit",
  release_dates: [
    {
      id: 941456,
      date: 1779408000,
      human: "May 22, 2026",
      platform: 169,
      status: 6,
      date_format: 0,
      release_region: 8,
    },
    {
      id: 941451,
      date: 1779148800,
      human: "May 19, 2026",
      platform: 6,
      status: 34,
      date_format: 0,
      release_region: 8,
    },
    {
      id: 941452,
      date: 1779408000,
      human: "May 22, 2026",
      platform: 6,
      status: 6,
      date_format: 0,
      release_region: 8,
    },
    {
      id: 941453,
      date: 1779148800,
      human: "May 19, 2026",
      platform: 167,
      status: 34,
      date_format: 0,
      release_region: 8,
    },
    {
      id: 941454,
      date: 1779408000,
      human: "May 22, 2026",
      platform: 167,
      status: 6,
      date_format: 0,
      release_region: 8,
    },
    {
      id: 941455,
      date: 1779148800,
      human: "May 19, 2026",
      platform: 169,
      status: 34,
      date_format: 0,
      release_region: 8,
    },
  ],
};

export const compatibilityRelease: FullGame = {
  id: 420499,
  name: "Doki Doki Poyatchio!!",
  release_dates: [
    {
      id: 970430,
      date: 905385600,
      human: "Sep 10, 1998",
      platform: 7,
      status: 6,
      date_format: 0,
      release_region: 5,
    },
    {
      id: 970431,
      date: 1461110400,
      human: "Apr 20, 2016",
      platform: 9,
      status: 35,
      date_format: 0,
      release_region: 5,
    },
    {
      id: 970432,
      date: 1461110400,
      human: "Apr 20, 2016",
      platform: 38,
      status: 35,
      date_format: 0,
      release_region: 5,
    },
  ],
};

export const witcher3Complete: FullGame = {
  id: 119402,
  name: "The Witcher 3: Wild Hunt - Complete Edition",
  version_parent: 1942,
  version_title: "Complete Edition",
  game_type: 3,
};

type ReleaseDateRow = NonNullable<FullGame["release_dates"]>[number];
type ExternalGameRow = NonNullable<FullGame["external_games"]>[number];
type WebsiteRow = NonNullable<FullGame["websites"]>[number];

/** Single `release_dates` rows of other games, one per kind of precision. */
export const releaseRows: Record<"month" | "q4" | "q1" | "year" | "oldYear" | "before1970", ReleaseDateRow> =
  {
    month: {
      id: 975533,
      date: 1790812800,
      human: "Oct 2026",
      platform: 14,
      status: 6,
      date_format: 1,
      release_region: 8,
    },
    q4: {
      id: 975534,
      date: 1798675200,
      human: "Q4 2026",
      platform: 6,
      status: 6,
      date_format: 6,
      release_region: 8,
    },
    q1: {
      id: 975567,
      date: 1806451200,
      human: "Q1 2027",
      platform: 6,
      status: 6,
      date_format: 3,
      release_region: 8,
    },
    // Year-only dates are stored on December 31, or January 1 on some old rows.
    year: {
      id: 975554,
      date: 1830211200,
      human: "2027",
      platform: 49,
      status: 6,
      date_format: 2,
      release_region: 8,
    },
    oldYear: { id: 298, date: 725846400, human: "1993", platform: 6, date_format: 2, release_region: 8 },
    before1970: {
      id: 31519,
      date: -694396800,
      human: "1947",
      platform: 100,
      date_format: 2,
      release_region: 8,
    },
  };

/** `external_games` rows without a URL, or with one that is not a store page. */
export const externalRows: Record<
  | "steamWithoutUrl"
  | "androidWithoutUrl"
  | "amazonGermany"
  | "amazonIndia"
  | "xbox360Marketplace"
  | "utomikApi"
  | "utomik",
  ExternalGameRow
> = {
  steamWithoutUrl: { id: 2000608, uid: "1338610", external_game_source: 1 },
  androidWithoutUrl: { id: 2000567, uid: "com.riotgames.league.teamfighttactics", external_game_source: 15 },
  amazonGermany: {
    id: 1865381,
    uid: "B07SV2KNHR",
    platform: 130,
    countries: [276],
    external_game_source: 20,
    game_release_format: 2,
  },
  amazonIndia: {
    id: 3223346,
    uid: "B00HQEN7Y4",
    platform: 9,
    countries: [356],
    external_game_source: 20,
    game_release_format: 2,
  },
  xbox360Marketplace: {
    id: 2629999,
    uid: "66acd000-77fe-1000-9115-d8024a5707d2",
    url: "https://marketplace.xbox.com/en-US/Product/ArcaniA/66acd000-77fe-1000-9115-d8024a5707d2",
    external_game_source: 31,
  },
  utomikApi: {
    id: 2965286,
    uid: "2460",
    url: "https://api.utomik.com/v1/applications/2460",
    external_game_source: 29,
  },
  utomik: {
    id: 2133259,
    uid: "hitman-absolution",
    url: "https://www.utomik.com/games/hitman-absolution",
    external_game_source: 29,
  },
};

/** `websites` rows IGDB marks untrusted because their address does not match their type. */
export const untrustedWebsites: Record<"archivedSteam" | "xboxTypedAsEpic" | "typo", WebsiteRow> = {
  archivedSteam: {
    id: 913697,
    trusted: false,
    url: "https://web.archive.org/web/20240811161819/https://store.steampowered.com/app/2933500/STARWIELD/",
  },
  xboxTypedAsEpic: {
    id: 917715,
    trusted: false,
    url: "https://www.xbox.com/en-us/games/store/mechwarrior-5-clans-wolves-of-tukayyid/9np62v3x54xq",
  },
  typo: { id: 1052830, trusted: false, url: "https://store.epicgames.coms/p/blindfire-5cd09d" },
};

/** `game_time_to_beats` rows. */
export const timeToBeatRows: Record<
  "witcher3" | "fortnite" | "hastilyOnly" | "empty",
  SelectResult<GameTimeToBeat, "game_id" | "hastily" | "normally" | "completely" | "count">
> = {
  witcher3: { id: 432, game_id: 1942, hastily: 134552, normally: 254778, completely: 581483, count: 41 },
  // The averages come from different submissions: hastily is above normally here.
  fortnite: {
    id: 3641,
    game_id: 1905,
    hastily: 13821428,
    normally: 1072800,
    completely: 45087428,
    count: 27,
  },
  hastilyOnly: { id: 26, game_id: 753, hastily: 154920, count: 1 },
  empty: { id: 5262, game_id: 293842, count: 1 },
};
