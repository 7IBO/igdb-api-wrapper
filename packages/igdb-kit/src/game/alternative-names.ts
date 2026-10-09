import type { ItemOf, Requires } from "./select";

/** Fields of `alternative_names` that {@link alternativeTitles} reads. */
export type AlternativeNameFields = "alternative_names.name" | "alternative_names.comment";

/** What an alternative name is, read from its free-text `comment`. */
export type AlternativeNameKind =
  /** A title in a language: "Japanese title", "Chinese title - simplified", "Brazilian title". */
  | "language"
  /** A market's title: "European title", "North American title", "UK title", "PAL title". */
  | "regional"
  /** The title on one platform or store: "Steam title", "iOS title", "Japanese PSX title" aside. */
  | "platform"
  /** "Alternative title", "Alias", "Also known as", "Other". */
  | "alternative"
  /** "Stylized title": the logo's capitals and symbols. */
  | "stylized"
  /** "Alternative spelling". */
  | "spelling"
  /** "Abbreviation", "Acronym", "Short title". */
  | "abbreviation"
  /** "Working title", "Project title", a cancelled or former title. */
  | "working"
  /** "Windows Executable": a file name, such as `witcher3.exe`. */
  | "executable"
  /** Anything else: "Full title", "Re-release", "Product code", or no comment. */
  | "other";

/** Which form of the title an alternative name is, when its comment says. */
export type AlternativeNameVariant =
  /** "Japanese title - original": the title as written in the language. */
  | "original"
  /**
   * "Japanese title - translated". Usually an English translation of the original title for
   * Japanese, Chinese and Portuguese, but a translation into the language for Korean.
   */
  | "translated"
  /** "Japanese title - romanization", "romaji", "Chinese title - PinYin": the title in Latin letters. */
  | "romanized"
  | "stylized"
  | "spelling"
  | "abbreviation"
  | "alternative"
  | "unofficial"
  /** A working, project, tentative or cancelled title. */
  | "working"
  /** A former title: "Previous Japanese title", "Korean title - old". */
  | "former";

/** What {@link parseAlternativeName} reads from a comment. */
export interface AlternativeNameInfo {
  kind: AlternativeNameKind;
  /**
   * BCP 47 tag of the language or market the comment names: `"ja"`, `"zh-Hans"`, `"zh-TW"`,
   * `"pt-BR"`, `"en-GB"` for "UK title". Null when it names none (a European or international title
   * can be in any language). A `"translated"` or `"romanized"` name is usually not written in it.
   */
  language: string | null;
  variant: AlternativeNameVariant | null;
}

/** An alternative name with what its comment says, from {@link alternativeTitles}. */
export interface AlternativeTitle<R = { name?: string | undefined; comment?: string | undefined }>
  extends AlternativeNameInfo {
  name: string;
  /** IGDB's free-text comment, null when there is none. */
  comment: string | null;
  /** The `alternative_names` row as selected. */
  row: R;
}

// Typos found in IGDB's comments, fixed before parsing.
const typos: [RegExp, string][] = [
  [/\bt+it(?:i|t)?l(?:t)?e\b/g, "title"],
  [/\ba(?:t|tl)?(?:er|re)native\b/g, "alternative"],
  [/\babb?e?r?viation\b|\babber?vation\b|\babbervation\b/g, "abbreviation"],
  [/\bar?conym\b|\bacroy?nm\b/g, "acronym"],
  [/\bportugual\b/g, "portuguese"],
  [/\bbrazill?ian\b/g, "brazilian"],
  [/\bbritt?ish\b/g, "british"],
  [/\bisreal\b/g, "israel"],
  [/\beuopean\b/g, "european"],
  [/\baustrai?li[ae]n\b/g, "australian"],
  [/\boher\b/g, "other"],
  [/\bstean\b/g, "steam"],
  [/\binofficial\b/g, "unofficial"],
];

// Languages and peoples, as written in comments, with their BCP 47 tag. Multi-word names first.
const languages: [RegExp, string][] = [
  [/\bbrazilian portuguese\b|\bportuguese \(brazil(?:ian)?\)/, "pt-BR"],
  [/\b(?:simplified chinese|chinese simplified|chinese (?:title |spelling )?\(simplified\))/, "zh-Hans"],
  [/\b(?:traditional chinese|chinese traditional|chinese (?:title |spelling )?\(traditional\))/, "zh-Hant"],
  [/\btaiwan(?:ese)?\b/, "zh-TW"],
  [/\benglish \(uk\)/, "en-GB"],
  [/\blatin america(?:n)?\b|\bperuvian\b/, "es-419"],
  [/\bjapan(?:ese)?\b/, "ja"],
  [/\bchin(?:ese|a)\b|\bmandarin\b/, "zh"],
  [/\bkorea(?:n)?\b/, "ko"],
  [/\bfrench\b/, "fr"],
  [/\bgerman(?:y)?\b/, "de"],
  [/\brussian\b/, "ru"],
  [/\bspanish\b/, "es"],
  [/\bbrazil(?:ian)?\b/, "pt-BR"],
  [/\bportuguese\b/, "pt"],
  [/\bitalian\b/, "it"],
  [/\bpolish\b/, "pl"],
  [/\bbulgarian\b/, "bg"],
  [/\bczech\b/, "cs"],
  [/\bslovak(?:ian)?\b/, "sk"],
  [/\bswedish\b/, "sv"],
  [/\bdutch\b|\bnederlands\b/, "nl"],
  [/\bhebrew\b|\bisraeli?\b/, "he"],
  [/\bhungarian\b/, "hu"],
  [/\bfinnish\b/, "fi"],
  [/\bdanish\b/, "da"],
  [/\bnorwegian\b/, "nb"],
  [/\barabic\b|\barabian\b/, "ar"],
  [/\bvietnamese\b/, "vi"],
  [/\bturkish\b/, "tr"],
  [/\bthai\b/, "th"],
  [/\bukrainian\b/, "uk"],
  [/\bestonian\b/, "et"],
  [/\bromanian\b/, "ro"],
  [/\bcroatian\b/, "hr"],
  [/\bserbian\b/, "sr"],
  [/\bslovenian\b/, "sl"],
  [/\bbelarusian\b/, "be"],
  [/\bgreek\b/, "el"],
  [/\bindonesian?\b/, "id"],
  [/\bpersian\b/, "fa"],
  [/\bkurdish\b/, "ku"],
  [/\bhindi\b/, "hi"],
  [/\bcorsican\b/, "co"],
  [/\benglish\b/, "en"],
];

// Markets whose title is not tied to one language, or is in English.
const markets: [RegExp, string | null][] = [
  [/\b(?:europe(?:an)?|eu|pal|international|western|asian?|south american)\b/, null],
  [/\b(?:uk|british|united kingdom)\b/, "en-GB"],
  [/\b(?:americ(?:a|an)|u\.?s\.?a?|united states|na)\b/, "en-US"],
  [/\baustralian?\b/, "en-AU"],
];

// Platforms and stores, as named in comments.
const platforms = words(
  "steam|gog|egs|epic|ubi store|ios|android|app store|play store|google play|microsoft store|store|mobile",
  "smartphone|iphone|ipad|browser|arcade|consoles?|pc|windows|dos|mac|xbox|playstation|ps[1-5p]?|psn|psx",
  "nintendo|switch|wii(?: u)?|3ds|ds|dsiware|snes|nes|famicom|n64|game ?boy|gbc|gba|sega|genesis",
  "mega ?drive|saturn|dreamcast|master system|game gear|amiga|atari|commodore|c64|vic-20|zx spectrum|msx",
  "3do|fm towns|pc-9801|satellaview|bbc micro|dragon 32|coleco|cd32|jaguar|acorn|8-bit|big fish|walmart",
  "metacritic|trophy list",
);

// Variants, strongest first: "stylized romanization" is a romanization.
const variants: [RegExp, AlternativeNameVariant][] = [
  [/\broman(?:i[sz]ation|i[sz]ed)\b|\bromaji\b|\bhepburn\b|\bpinyin\b|\btransliteration\b/, "romanized"],
  [
    words(
      "working|project|development|tentative|teaser|prototype|placeholder|cancell?ed|initial|rumou?red",
      "announcement|incorrectly",
    ),
    "working",
  ],
  [/\bformer\b|\bprevious\b|\bold\b/, "former"],
  [/\btranslat(?:ed|ion|e)\b|\bliteral\b/, "translated"],
  [/\babbreviat(?:ion|ed)\b|\bacronym\b|\bbackronym\b|\bshort(?:ened)?\b|\bshort-name\b/, "abbreviation"],
  [/\bunofficial\b|\bfan\b|\binformal\b|\bcolloquialism\b/, "unofficial"],
  [/\bspelling\b|\bcapitali[sz]ation\b/, "spelling"],
  [/\bstyli[sz](?:ed|ation)\b/, "stylized"],
  [/\boriginal\b/, "original"],
  [
    /\balternat(?:iv)?e\b|\balias\b|\bother\b|\balso known as\b|\baka\b|\bcommon(?:ly used)?\b/,
    "alternative",
  ],
];

const kindOfVariant: Partial<Record<AlternativeNameVariant, AlternativeNameKind>> = {
  stylized: "stylized",
  spelling: "spelling",
  abbreviation: "abbreviation",
  working: "working",
  former: "working",
  alternative: "alternative",
  unofficial: "alternative",
};

/**
 * Reads the free-text `comment` of an `alternative_names` row: 739 different comments in IGDB, from
 * "Japanese title - romanization" and "Chinese title - simplified" to "Brazilian title", "Korean
 * title - translated", "UK title" or "Windows Executable", with their typos and capitalizations.
 *
 * ```ts
 * parseAlternativeName("Japanese title - romanization"); // { kind: "language", language: "ja", variant: "romanized" }
 * parseAlternativeName("Chinese title - traditional");   // { kind: "language", language: "zh-Hant", variant: null }
 * parseAlternativeName("Steam title");                   // { kind: "platform", language: null, variant: null }
 * ```
 */
export function parseAlternativeName(comment: string | null | undefined): AlternativeNameInfo {
  let text = (comment ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  for (const [typo, fix] of typos) text = text.replace(typo, fix);
  if (!text || text === "none") return { kind: "other", language: null, variant: null };
  if (/\bexecutable\b|\bfile ?name\b/.test(text))
    return { kind: "executable", language: null, variant: null };

  const variant = variants.find(([pattern]) => pattern.test(text))?.[1] ?? null;
  let language = languages.find(([pattern]) => pattern.test(text))?.[1] ?? null;
  if (language === "zh") {
    // "Chinese title - simplified", "Chinese Simplified", "Alternative Chinese title - traditional".
    if (/\bsimplified\b/.test(text)) language = "zh-Hans";
    else if (/\btraditional\b/.test(text)) language = "zh-Hant";
  }
  if (language !== null) return { kind: "language", language, variant };

  const market = markets.find(([pattern]) => pattern.test(text));
  if (market) return { kind: "regional", language: market[1], variant };
  if (platforms.test(text)) return { kind: "platform", language: null, variant };
  return { kind: (variant && kindOfVariant[variant]) ?? "other", language: null, variant };
}

/**
 * The alternative names of a game with what their comments say (see {@link parseAlternativeName}),
 * in IGDB's order, without the executable file names (41% of all rows). Filter them by `kind`,
 * `language` or `variant`: `alternativeTitles(game).filter((t) => t.kind === "abbreviation")`.
 */
export function alternativeTitles<G extends object>(
  game: G & Requires<G, AlternativeNameFields>,
): AlternativeTitle<ItemOf<G, "alternative_names">>[] {
  const rows = (game as { alternative_names?: readonly { name?: string; comment?: string }[] })
    .alternative_names;
  const titles: AlternativeTitle[] = [];
  for (const row of rows ?? []) {
    const name = row.name?.trim();
    if (!name) continue;
    const info = parseAlternativeName(row.comment);
    if (info.kind === "executable") continue;
    titles.push({ name, comment: row.comment?.trim() || null, ...info, row });
  }
  return titles as AlternativeTitle<ItemOf<G, "alternative_names">>[];
}

/** A regular expression matching any of the "|"-separated words or phrases, as whole words. */
function words(...lists: string[]): RegExp {
  return new RegExp(`\\b(?:${lists.join("|")})\\b`);
}
