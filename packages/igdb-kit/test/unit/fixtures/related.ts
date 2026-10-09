// Real IGDB responses (October 2026), trimmed to the rows the tests need. Regenerate by hand.
import type { Game, Platform, SelectResult } from "../../../src";

export type RelatedGame = SelectResult<Game, RelatedFields>;

type RelatedFields =
  | "name"
  | "game_type"
  | "parent_game.name"
  | "version_parent.name"
  | "version_title"
  | "dlcs.name"
  | "expansions.name"
  | "standalone_expansions.name"
  | "remakes.name"
  | "remasters.name"
  | "expanded_games.name"
  | "ports.name"
  | "forks.name"
  | "bundles.name"
  | "franchise.name"
  | "franchises.name"
  | "external_games.external_game_source"
  | "external_games.uid"
  | "external_games.url"
  | "websites.type"
  | "websites.url"
  | "websites.trusted"
  | "videos.video_id"
  | "videos.name"
  | "cover.image_id"
  | "cover.width"
  | "cover.height"
  | "artworks.image_id"
  | "artworks.image_type"
  | "artworks.artwork_type"
  | "artworks.width"
  | "artworks.height"
  | "screenshots.image_id"
  | "screenshots.width"
  | "screenshots.height";

export const witcher3: RelatedGame = {
  id: 1942,
  artworks: [
    {
      id: 303975,
      height: 128,
      image_id: "ar6ijr",
      width: 128,
      artwork_type: 12,
      image_type: 13,
    },
    {
      id: 168458,
      height: 4463,
      image_id: "ar3lze",
      width: 7133,
      artwork_type: 4,
      image_type: 4,
    },
    {
      id: 168459,
      height: 780,
      image_id: "ar3lzf",
      width: 1200,
      artwork_type: 4,
      image_type: 4,
    },
    {
      id: 168463,
      height: 710,
      image_id: "ar3lzj",
      width: 1200,
      artwork_type: 4,
      image_type: 4,
    },
    {
      id: 168460,
      height: 6071,
      image_id: "ar3lzg",
      width: 10000,
      artwork_type: 4,
      image_type: 4,
    },
    {
      id: 168465,
      height: 670,
      image_id: "ar3lzl",
      width: 1200,
      artwork_type: 4,
      image_type: 4,
    },
    {
      id: 168461,
      height: 800,
      image_id: "ar3lzh",
      width: 1100,
      artwork_type: 4,
      image_type: 4,
    },
    {
      id: 168464,
      height: 7874,
      image_id: "ar3lzk",
      width: 10681,
      artwork_type: 2,
      image_type: 2,
    },
    {
      id: 168457,
      height: 610,
      image_id: "ar3lzd",
      width: 1260,
      artwork_type: 4,
      image_type: 4,
    },
    {
      id: 168455,
      height: 675,
      image_id: "ar3lzb",
      width: 1200,
      artwork_type: 4,
      image_type: 4,
    },
  ],
  bundles: [
    {
      id: 22439,
      name: "The Witcher 3: Wild Hunt - Game of the Year Edition",
    },
    {
      id: 141472,
      name: "The Witcher 3: Wild Hunt + Dark Souls III",
    },
    {
      id: 119402,
      name: "The Witcher 3: Wild Hunt - Complete Edition",
    },
  ],
  cover: {
    id: 480513,
    height: 800,
    image_id: "coaarl",
    width: 600,
  },
  dlcs: [
    {
      id: 157580,
      name: "The Witcher 3: Wild Hunt - New Quest 'Contract: Skellige's Most Wanted'",
    },
    {
      id: 226413,
      name: "The Witcher 3: Wild Hunt - New Quest: Scavenger Hunt: Wolf School Gear",
    },
    {
      id: 170449,
      name: "The Witcher 3: Wild Hunt - New Quest 'Where the Cat and Wolf Play...'",
    },
    {
      id: 170450,
      name: "The Witcher 3: Wild Hunt - New Quest 'Fool's Gold'",
    },
    {
      id: 170451,
      name: "The Witcher 3: Wild Hunt - New Quest 'Contract: Missing Miners'",
    },
  ],
  expansions: [
    {
      id: 13166,
      name: "The Witcher 3: Wild Hunt - Blood and Wine",
    },
    {
      id: 12503,
      name: "The Witcher 3: Wild Hunt - Hearts of Stone",
    },
    {
      id: 403150,
      name: "The Witcher 3: Wild Hunt - Songs of the Past",
    },
  ],
  external_games: [
    {
      id: 1935171,
      uid: "B00T3SPV36",
      external_game_source: 20,
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
      external_game_source: 20,
    },
    {
      id: 11306,
      uid: "292030",
      url: "https://store.steampowered.com/app/292030",
      external_game_source: 1,
    },
    {
      id: 119254,
      uid: "41484",
      url: "https://www.giantbomb.com/games/3030-41484/",
      external_game_source: 3,
    },
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
  franchises: [
    {
      id: 452,
      name: "The Witcher",
    },
  ],
  name: "The Witcher 3: Wild Hunt",
  screenshots: [
    {
      id: 1377966,
      height: 1440,
      image_id: "sctj8u",
      width: 2560,
    },
    {
      id: 21107,
      height: 1080,
      image_id: "farvemmmxav0bgt6wx7t",
      width: 1920,
    },
  ],
  videos: [
    {
      id: 9648,
      name: "Developer Diary: Creating the Sound",
      video_id: "yowv6_rspoM",
    },
    {
      id: 5993,
      name: "TV Spot",
      video_id: "xQGam9OHSUo",
    },
    {
      id: 5990,
      name: "Opening Cinematic: The Trail",
      video_id: "QrwGXAcE6ZA",
    },
    {
      id: 5992,
      name: "Recap",
      video_id: "bcEAsOC_8L0",
    },
    {
      id: 5987,
      name: "The Begining trailer",
      video_id: "5nLipy-Z4yo",
    },
    {
      id: 5995,
      name: "A Night to Remember Trailer",
      video_id: "8ZLfJjlZKvc",
    },
    {
      id: 5994,
      name: "Rage & Steel Trailer",
      video_id: "p14dHAwLOmo",
    },
    {
      id: 5991,
      name: "Elder Blood Trailer",
      video_id: "6f8TbvsZ5Mk",
    },
    {
      id: 5989,
      name: "Downwarren Gameplay Video",
      video_id: "_IBAovRNCuA",
    },
    {
      id: 5988,
      name: "Killing Monsters Cinematic Trailer",
      video_id: "FP7no968jVU",
    },
    {
      id: 5996,
      name: "Debut Gameplay Trailer",
      video_id: "sb81f-ejNSI",
    },
    {
      id: 150458,
      name: "Trailer",
      video_id: "TWOkT7l0yWQ",
    },
    {
      id: 15748,
      name: "10th Anniversary Video",
      video_id: "ZpiczsigQto",
    },
    {
      id: 120257,
      name: "Gameplay Demo",
      video_id: "gRmKKjQu9Tw",
    },
    {
      id: 141704,
      name: "VGX 2013 Trailer",
      video_id: "MqQ3LeBgGDM",
    },
    {
      id: 141210,
      name: "Cinematic Trailer",
      video_id: "c0i88t0Kacs",
    },
    {
      id: 141211,
      name: "Launch Trailer",
      video_id: "1-l29HlKkXU",
    },
  ],
  websites: [
    {
      id: 19103,
      trusted: true,
      url: "https://www.facebook.com/CDPROJEKTRED",
      type: 4,
    },
    {
      id: 141346,
      trusted: true,
      url: "https://www.epicgames.com/store/en-US/product/the-witcher-3-wild-hunt/home",
      type: 16,
    },
    {
      id: 793706,
      trusted: false,
      url: "https://www.xbox.com/en-us/games/store/the-witcher-3-wild-hunt/BR765873CQJD",
      type: 22,
    },
    {
      id: 793707,
      trusted: false,
      url: "https://store.playstation.com/en-us/concept/204794",
      type: 23,
    },
    {
      id: 793708,
      trusted: false,
      url: "https://www.nintendo.com/games/detail/the-witcher-3-wild-hunt-switch/",
      type: 24,
    },
    {
      id: 19102,
      trusted: true,
      url: "https://en.wikipedia.org/wiki/The_Witcher_3:_Wild_Hunt",
      type: 3,
    },
    {
      id: 19107,
      trusted: true,
      url: "https://store.steampowered.com/app/292030",
      type: 13,
    },
    {
      id: 66471,
      trusted: false,
      url: "http://www.thewitcher.com",
      type: 1,
    },
    {
      id: 119948,
      trusted: true,
      url: "https://www.gog.com/game/the_witcher_3_wild_hunt",
      type: 17,
    },
    {
      id: 19101,
      trusted: false,
      url: "http://witcher.wikia.com/wiki/The_Witcher_3:_Wild_Hunt",
      type: 2,
    },
    {
      id: 19104,
      trusted: true,
      url: "https://twitter.com/witchergame",
      type: 5,
    },
    {
      id: 78076,
      trusted: true,
      url: "https://www.reddit.com/r/witcher",
      type: 14,
    },
    {
      id: 19105,
      trusted: true,
      url: "https://www.instagram.com/cdpred",
      type: 8,
    },
    {
      id: 19106,
      trusted: true,
      url: "https://www.youtube.com/user/WitcherGame",
      type: 9,
    },
    {
      id: 512145,
      trusted: true,
      url: "https://www.twitch.tv/directory/game/The%20Witcher%203:%20Wild%20Hunt",
      type: 6,
    },
    {
      id: 670803,
      trusted: true,
      url: "https://discord.gg/thewitcher",
      type: 18,
    },
  ],
  game_type: 0,
};

export const gta5: RelatedGame = {
  id: 1020,
  artworks: [
    {
      id: 168666,
      height: 956,
      image_id: "ar3m56",
      width: 1106,
      artwork_type: 7,
      image_type: 7,
    },
    {
      id: 312450,
      height: 1240,
      image_id: "ar6p36",
      width: 3840,
      artwork_type: 1,
      image_type: 1,
    },
    {
      id: 297117,
      height: 494,
      image_id: "ar6d99",
      width: 736,
      artwork_type: 15,
      image_type: 16,
    },
    {
      id: 297127,
      height: 790,
      image_id: "ar6d9j",
      width: 1260,
      artwork_type: 3,
      image_type: 3,
    },
    {
      id: 297128,
      height: 790,
      image_id: "ar6d9k",
      width: 1260,
      artwork_type: 3,
      image_type: 3,
    },
    {
      id: 297121,
      height: 790,
      image_id: "ar6d9d",
      width: 1260,
      artwork_type: 3,
      image_type: 3,
    },
    {
      id: 297122,
      height: 790,
      image_id: "ar6d9e",
      width: 1260,
      artwork_type: 3,
      image_type: 3,
    },
    {
      id: 297123,
      height: 790,
      image_id: "ar6d9f",
      width: 1260,
      artwork_type: 3,
      image_type: 3,
    },
    {
      id: 297124,
      height: 790,
      image_id: "ar6d9g",
      width: 1260,
      artwork_type: 3,
      image_type: 3,
    },
    {
      id: 297125,
      height: 790,
      image_id: "ar6d9h",
      width: 1260,
      artwork_type: 3,
      image_type: 3,
    },
  ],
  bundles: [
    {
      id: 239064,
      name: "Grand Theft Auto V",
    },
    {
      id: 98077,
      name: "Grand Theft Auto V: Premium Online Edition",
    },
  ],
  cover: {
    id: 120937,
    height: 1580,
    image_id: "co2lbd",
    width: 1185,
  },
  external_games: [
    {
      id: 1935351,
      uid: "B00NOP3QF4",
      external_game_source: 20,
    },
    {
      id: 1935867,
      uid: "B0062KIC2A",
      external_game_source: 20,
    },
    {
      id: 123664,
      uid: "36765",
      url: "https://www.giantbomb.com/games/3030-36765/",
      external_game_source: 3,
    },
    {
      id: 213597,
      uid: "xbox36066acd000-77fe-1000-9115-d802545408a7",
      url: "http://marketplace.xbox.com/en-US/Product/GTA-V/66acd000-77fe-1000-9115-d802545408a7",
      external_game_source: 11,
    },
    {
      id: 2635398,
      uid: "B09WZ6F8P5",
      url: "https://amazon.fr/dp/B09WZ6F8P5",
      external_game_source: 20,
    },
    {
      id: 2635395,
      uid: "B09WZ6F8P5",
      url: "https://amazon.es/dp/B09WZ6F8P5",
      external_game_source: 20,
    },
    {
      id: 189925,
      uid: "UCT1tnevF8bn9Nwr6ZHA9Mag",
      url: "https://gaming.youtube.com/game/UCT1tnevF8bn9Nwr6ZHA9Mag",
      external_game_source: 10,
    },
    {
      id: 2635401,
      uid: "B09WZ6F8P5",
      url: "https://amazon.it/dp/B09WZ6F8P5",
      external_game_source: 20,
    },
    {
      id: 210553,
      uid: "BPJ686W6S0NH",
      url: "https://www.xbox.com/en-us/games/store/grand-theft-auto-v-xbox-one/BPJ686W6S0NH",
      external_game_source: 11,
    },
    {
      id: 2118073,
      uid: "bd136eaa-528f-4f54-af01-92124e014a94",
      url: "https://www.epicgames.com/store/p/grand-theft-auto-v",
      external_game_source: 26,
    },
    {
      id: 2161127,
      uid: "66acd000-77fe-1000-9115-d802545408a7",
      url: "https://marketplace.xbox.com//en-US/Product/GTA-V/66acd000-77fe-1000-9115-d802545408a7",
      external_game_source: 31,
    },
    {
      id: 189339,
      uid: "UChoveWrDASwMxB5_iNot07A",
      url: "https://gaming.youtube.com/game/UChoveWrDASwMxB5_iNot07A",
      external_game_source: 10,
    },
    {
      id: 2171945,
      uid: "201930",
      url: "https://store.playstation.com/en-us/concept/201930",
      external_game_source: 36,
    },
    {
      id: 11827,
      uid: "271590",
      url: "https://store.steampowered.com/app/271590",
      external_game_source: 1,
    },
    {
      id: 245105,
      uid: "32982",
      url: "https://www.twitch.tv/directory/game/Grand Theft Auto V",
      external_game_source: 14,
    },
  ],
  franchises: [
    {
      id: 493,
      name: "Grand Theft Auto",
    },
  ],
  name: "Grand Theft Auto V",
  screenshots: [
    {
      id: 6913,
      height: 720,
      image_id: "n3t2agwuxlqggp3kryf9",
      width: 1280,
    },
    {
      id: 1699381,
      height: 415,
      image_id: "sc10f91",
      width: 739,
    },
  ],
  standalone_expansions: [
    {
      id: 134710,
      name: "Grand Theft Auto Online",
    },
  ],
  videos: [
    {
      id: 3164,
      name: "Next-gen Launch Trailer",
      video_id: "PIF_fqFZEuk",
    },
    {
      id: 710,
      name: "Trailer",
      video_id: "QkkoHAzjnUs",
    },
    {
      id: 1420,
      name: "Gameplay video",
      video_id: "N-xHcvug3WI",
    },
    {
      id: 120376,
      name: "Trailer",
      video_id: "UWzV0AFXukI",
    },
  ],
  websites: [
    {
      id: 41200,
      trusted: true,
      url: "https://www.facebook.com/grandtheftautoV",
      type: 4,
    },
    {
      id: 799858,
      trusted: false,
      url: "https://www.xbox.com/en-us/games/store/grand-theft-auto-v-xbox-one/BPJ686W6S0NH",
      type: 22,
    },
    {
      id: 913405,
      trusted: true,
      url: "https://www.twitch.tv/directory/category/grand-theft-auto-v",
      type: 6,
    },
    {
      id: 913406,
      trusted: true,
      url: "https://x.com/RockstarGames",
      type: 5,
    },
    {
      id: 913407,
      trusted: true,
      url: "https://www.youtube.com/@RockstarGames",
      type: 9,
    },
    {
      id: 935671,
      trusted: false,
      url: "https://www.rockstargames.com/V/",
      type: 1,
    },
    {
      id: 799859,
      trusted: false,
      url: "https://store.playstation.com/en-us/concept/201930",
      type: 23,
    },
    {
      id: 826901,
      trusted: true,
      url: "https://discord.gg/rockstargames",
      type: 18,
    },
    {
      id: 141326,
      trusted: true,
      url: "https://www.epicgames.com/store/en-US/product/grand-theft-auto-v/home",
      type: 16,
    },
    {
      id: 41203,
      trusted: true,
      url: "https://www.instagram.com/rockstargames",
      type: 8,
    },
    {
      id: 18733,
      trusted: true,
      url: "https://store.steampowered.com/app/271590",
      type: 13,
    },
    {
      id: 657288,
      trusted: true,
      url: "https://www.reddit.com/r/GTAV/",
      type: 14,
    },
    {
      id: 18732,
      trusted: true,
      url: "https://en.wikipedia.org/wiki/Grand_Theft_Auto_V",
      type: 3,
    },
    {
      id: 1068361,
      trusted: false,
      url: "https://gta.wiki/w/Grand_Theft_Auto_V",
      type: 2,
    },
  ],
  expanded_games: [
    {
      id: 334254,
      name: "Grand Theft Auto V Enhanced",
    },
  ],
  game_type: 0,
};

export const eldenRing: RelatedGame = {
  id: 119133,
  artworks: [
    {
      id: 168540,
      height: 920,
      image_id: "ar3m1o",
      width: 5981,
      artwork_type: 6,
      image_type: 6,
    },
    {
      id: 168541,
      height: 920,
      image_id: "ar3m1p",
      width: 5981,
      artwork_type: 5,
      image_type: 5,
    },
    {
      id: 52129,
      height: 620,
      image_id: "ar1481",
      width: 1920,
      artwork_type: 1,
      image_type: 1,
    },
    {
      id: 168539,
      height: 920,
      image_id: "ar3m1n",
      width: 5981,
      artwork_type: 7,
      image_type: 7,
    },
  ],
  bundles: [
    {
      id: 287975,
      name: "Elden Ring: Shadow of the Erdtree Edition",
    },
    {
      id: 287984,
      name: "Elden Ring: Shadow of the Erdtree Deluxe Edition",
    },
    {
      id: 338079,
      name: "Elden Ring: Tarnished Edition",
    },
  ],
  cover: {
    id: 212094,
    height: 2468,
    image_id: "co4jni",
    width: 1851,
  },
  dlcs: [
    {
      id: 415376,
      name: "Elden Ring: Tarnished Pack",
    },
  ],
  expansions: [
    {
      id: 240009,
      name: "Elden Ring: Shadow of the Erdtree",
    },
  ],
  external_games: [
    {
      id: 3190333,
      uid: "B09MG5LQ18",
      external_game_source: 20,
    },
    {
      id: 2062011,
      uid: "B09743F8P6",
      url: "https://amazon.com/dp/B09743F8P6",
      external_game_source: 20,
    },
    {
      id: 1775842,
      uid: "73745",
      url: "https://www.giantbomb.com/games/3030-73745/",
      external_game_source: 3,
    },
    {
      id: 2270864,
      uid: "9P3J32CTXLRZ",
      url: "https://www.xbox.com/en-us/games/store/elden-ring/9P3J32CTXLRZ",
      external_game_source: 11,
    },
    {
      id: 2271018,
      uid: "B09QPYZ6R2",
      url: "https://amazon.fr/dp/B09QPYZ6R2",
      external_game_source: 20,
    },
    {
      id: 2254892,
      uid: "B09QPYZ6R2",
      url: "https://amazon.fr/dp/B09QPYZ6R2",
      external_game_source: 20,
    },
    {
      id: 2084186,
      uid: "1245620",
      url: "https://store.steampowered.com/app/1245620",
      external_game_source: 1,
    },
    {
      id: 2241788,
      uid: "B09QPYZ6R2",
      url: "https://amazon.fr/dp/B09QPYZ6R2",
      external_game_source: 20,
    },
    {
      id: 1914490,
      uid: "512953",
      url: "https://www.twitch.tv/directory/game/ELDEN%20RING",
      external_game_source: 14,
    },
    {
      id: 2172221,
      uid: "10000333",
      url: "https://store.playstation.com/en-us/concept/10000333",
      external_game_source: 36,
    },
  ],
  franchises: [
    {
      id: 8190,
      name: "Elden Ring",
    },
  ],
  name: "Elden Ring",
  screenshots: [
    {
      id: 487788,
      height: 1080,
      image_id: "scagdo",
      width: 1920,
    },
    {
      id: 1406912,
      height: 1440,
      image_id: "scu5kw",
      width: 2560,
    },
  ],
  videos: [
    {
      id: 58619,
      name: "Trailer",
      video_id: "D1mDo1CEMuE",
    },
    {
      id: 50584,
      name: "Gameplay Trailer",
      video_id: "E3Huy2cdih0",
    },
    {
      id: 64564,
      name: "Launch Trailer",
      video_id: "qqiC88f9ogU",
    },
    {
      id: 61874,
      name: "Trailer",
      video_id: "D8YkCHkWRyk",
    },
    {
      id: 62187,
      name: "Trailer",
      video_id: "DbPbQMuEyX8",
    },
    {
      id: 62188,
      name: "Gameplay Trailer",
      video_id: "l6pCyV7PnqI",
    },
    {
      id: 121254,
      name: "Announcement Trailer",
      video_id: "e5wwSxl0atc",
    },
    {
      id: 185696,
      name: "Accolades Trailer",
      video_id: "gyMcCOc6bIM",
    },
  ],
  websites: [
    {
      id: 247126,
      trusted: true,
      url: "https://www.twitch.tv/directory/game/Elden%20Ring",
      type: 6,
    },
    {
      id: 247127,
      trusted: true,
      url: "https://www.youtube.com/c/BandaiNamcoEntertainmentAmerica",
      type: 9,
    },
    {
      id: 790471,
      trusted: false,
      url: "https://store.playstation.com/en-us/concept/10000333",
      type: 23,
    },
    {
      id: 790470,
      trusted: false,
      url: "https://www.xbox.com/en-us/games/store/elden-ring/9P3J32CTXLRZ",
      type: 22,
    },
    {
      id: 210645,
      trusted: true,
      url: "https://store.steampowered.com/app/1245620",
      type: 13,
    },
    {
      id: 225451,
      trusted: true,
      url: "https://www.facebook.com/ELDENRINGEU",
      type: 4,
    },
    {
      id: 125915,
      trusted: true,
      url: "https://twitter.com/ELDENRING",
      type: 5,
    },
    {
      id: 247128,
      trusted: true,
      url: "https://discord.gg/invite/eldenring",
      type: 18,
    },
    {
      id: 611948,
      trusted: false,
      url: "https://www.bandainamcoent.com/games/elden-ring",
      type: 1,
    },
    {
      id: 125916,
      trusted: true,
      url: "https://reddit.com/r/EldenRing",
      type: 14,
    },
    {
      id: 225452,
      trusted: true,
      url: "https://www.instagram.com/eldenring?hl=en",
      type: 8,
    },
    {
      id: 702891,
      trusted: false,
      url: "https://eldenring.wiki.gg/",
      type: 2,
    },
    {
      id: 225453,
      trusted: true,
      url: "https://en.wikipedia.org/wiki/Elden_Ring",
      type: 3,
    },
  ],
  game_type: 0,
};

export const witcher3Goty: RelatedGame = {
  id: 22439,
  artworks: [
    {
      id: 47102,
      height: 1080,
      image_id: "ar10ce",
      width: 1920,
      artwork_type: 1,
      image_type: 1,
    },
    {
      id: 47101,
      height: 1080,
      image_id: "ar10cd",
      width: 1920,
      artwork_type: 1,
      image_type: 1,
    },
  ],
  bundles: [
    {
      id: 154960,
      name: "The Witcher Franchise Bundle",
    },
  ],
  cover: {
    id: 89392,
    height: 1559,
    image_id: "co1wz4",
    width: 1170,
  },
  external_games: [
    {
      id: 1935039,
      uid: "B01L0TXXBW",
      external_game_source: 20,
    },
    {
      id: 1928635,
      uid: "B01JYW2F1G",
      external_game_source: 20,
    },
    {
      id: 2118072,
      uid: "76c257e9-3233-4448-9302-9fae20173fca",
      url: "https://www.epicgames.com/store/p/the-witcher-3-wild-hunt",
      external_game_source: 26,
    },
    {
      id: 2626638,
      uid: "9064fdd49de04718abe631788ad5a759",
      url: "https://store.epicgames.com/en-US/p/the-witcher-3-wild-hunt",
      external_game_source: 26,
    },
    {
      id: 2082675,
      uid: "C261457LCNMJ",
      url: "https://www.xbox.com/en-us/games/store/the-witcher-3-wild-hunt---complete-edition/C261457LCNMJ",
      external_game_source: 11,
    },
    {
      id: 2068955,
      uid: "1495134320",
      url: "https://www.gog.com/en/game/the_witcher_3_wild_hunt_game_of_the_year_edition_1821119272",
      external_game_source: 5,
    },
    {
      id: 78482,
      uid: "1640424747",
      url: "https://www.gog.com/en/game/the_witcher_3_wild_hunt_game_of_the_year_edition",
      external_game_source: 5,
    },
    {
      id: 2417234,
      uid: "499450",
      url: "https://store.steampowered.com/app/499450",
      external_game_source: 1,
    },
  ],
  franchises: [
    {
      id: 452,
      name: "The Witcher",
    },
  ],
  name: "The Witcher 3: Wild Hunt - Game of the Year Edition",
  screenshots: [
    {
      id: 117438,
      height: 551,
      image_id: "pziw7giojvmp8baw617b",
      width: 979,
    },
    {
      id: 117440,
      height: 551,
      image_id: "zvijqp04apwmzqvlgxej",
      width: 979,
    },
  ],
  version_parent: {
    id: 1942,
    name: "The Witcher 3: Wild Hunt",
  },
  version_title: "Game of the Year Edition",
  videos: [
    {
      id: 9657,
      name: "Trailer",
      video_id: "5wmNeg5WVck",
    },
    {
      id: 9649,
      name: "Launch Trailer",
      video_id: "YmLeUJgzsXY",
    },
    {
      id: 15239,
      name: "Trailer",
      video_id: "qy8jmm9kY4A",
    },
  ],
  websites: [
    {
      id: 53841,
      trusted: true,
      url: "https://instagram.com/cdpred",
      type: 8,
    },
    {
      id: 53837,
      trusted: false,
      url: "http://witcher.wikia.com/wiki/Witcher_Wiki",
      type: 2,
    },
    {
      id: 119883,
      trusted: true,
      url: "https://www.gog.com/game/the_witcher_3_wild_hunt_game_of_the_year_edition",
      type: 17,
    },
    {
      id: 865391,
      trusted: false,
      url: "https://www.xbox.com/en-us/games/store/the-witcher-3-wild-hunt---complete-edition/C261457LCNMJ",
      type: 22,
    },
    {
      id: 53839,
      trusted: true,
      url: "https://www.facebook.com/thewitcher",
      type: 4,
    },
    {
      id: 53840,
      trusted: true,
      url: "https://twitter.com/",
      type: 5,
    },
    {
      id: 221310,
      trusted: true,
      url: "https://www.epicgames.com/store/p/the-witcher-3-wild-hunt",
      type: 16,
    },
    {
      id: 53836,
      trusted: false,
      url: "http://thewitcher.com",
      type: 1,
    },
    {
      id: 53843,
      trusted: true,
      url: "https://store.steampowered.com/sub/124923",
      type: 13,
    },
    {
      id: 53838,
      trusted: true,
      url: "https://en.wikipedia.org/wiki/The_Witcher_3:_Wild_Hunt",
      type: 3,
    },
    {
      id: 53842,
      trusted: true,
      url: "https://www.youtube.com/user/WitcherGame",
      type: 9,
    },
    {
      id: 221312,
      trusted: true,
      url: "https://discord.gg/thewitcher",
      type: 18,
    },
    {
      id: 221311,
      trusted: true,
      url: "https://www.twitch.tv/cdprojektred",
      type: 6,
    },
  ],
  game_type: 3,
};

export type PlatformWithVersions = SelectResult<
  Platform,
  | "name"
  | "versions.name"
  | "versions.platform_version_release_dates.date"
  | "versions.platform_version_release_dates.date_format"
  | "versions.platform_version_release_dates.release_region"
  | "versions.platform_version_release_dates.human"
  | "versions.platform_version_release_dates.y"
  | "versions.platform_version_release_dates.m"
>;

export const playstation4: PlatformWithVersions = {
  id: 48,
  name: "PlayStation 4",
  versions: [
    {
      id: 17,
      name: "Initial version",
      platform_version_release_dates: [
        {
          id: 10,
          date: 1384473600,
          human: "Nov 15, 2013",
          m: 11,
          y: 2013,
          date_format: 0,
          release_region: 2,
        },
        {
          id: 11,
          date: 1385683200,
          human: "Nov 29, 2013",
          m: 11,
          y: 2013,
          date_format: 0,
          release_region: 1,
        },
        {
          id: 12,
          date: 1385683200,
          human: "Nov 29, 2013",
          m: 11,
          y: 2013,
          date_format: 0,
          release_region: 3,
        },
        {
          id: 13,
          date: 1385683200,
          human: "Nov 29, 2013",
          m: 11,
          y: 2013,
          date_format: 0,
          release_region: 4,
        },
      ],
    },
    {
      id: 178,
      name: "PlayStation 4 Slim",
      platform_version_release_dates: [
        {
          id: 206,
          date: 1473897600,
          human: "Sep 15, 2016",
          m: 9,
          y: 2016,
          date_format: 0,
          release_region: 8,
        },
      ],
    },
    {
      id: 179,
      name: "PlayStation 4 Pro",
      platform_version_release_dates: [
        {
          id: 207,
          date: 1478736000,
          human: "Nov 10, 2016",
          m: 11,
          y: 2016,
          date_format: 0,
          release_region: 8,
        },
      ],
    },
  ],
};

export const nintendoSwitch: PlatformWithVersions = {
  id: 130,
  name: "Nintendo Switch",
  versions: [
    {
      id: 282,
      name: "Switch Lite",
      platform_version_release_dates: [
        {
          id: 359,
          date: 1568937600,
          human: "Sep 20, 2019",
          m: 9,
          y: 2019,
          date_format: 0,
          release_region: 8,
        },
        {
          id: 797,
          date: 1633046400,
          human: "Oct 01, 2021",
          m: 10,
          y: 2021,
          date_format: 0,
          release_region: 10,
        },
      ],
    },
    {
      id: 503,
      name: "OLED Model",
      platform_version_release_dates: [
        {
          id: 798,
          date: 1664150400,
          human: "Sep 26, 2022",
          m: 9,
          y: 2022,
          date_format: 0,
          release_region: 10,
        },
        {
          id: 799,
          date: 1633651200,
          human: "Oct 08, 2021",
          m: 10,
          y: 2021,
          date_format: 0,
          release_region: 8,
        },
      ],
    },
    {
      id: 173,
      name: "Initial version",
      platform_version_release_dates: [
        {
          id: 217,
          date: 1488499200,
          human: "Mar 03, 2017",
          m: 3,
          y: 2017,
          date_format: 0,
          release_region: 8,
        },
        {
          id: 796,
          date: 1600387200,
          human: "Sep 18, 2020",
          m: 9,
          y: 2020,
          date_format: 0,
          release_region: 10,
        },
        {
          id: 795,
          date: 1575936000,
          human: "Dec 10, 2019",
          m: 12,
          y: 2019,
          date_format: 0,
          release_region: 6,
        },
        {
          id: 925,
          date: 1512086400,
          human: "Dec 01, 2017",
          m: 12,
          y: 2017,
          date_format: 0,
          release_region: 9,
        },
      ],
    },
  ],
};
