import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GameType, Genre, ReleaseDateStatus } from "../../src";
import { createLabels, en, type LabelDictionary } from "../../src/i18n";
import { de } from "../../src/i18n/de";
import { es } from "../../src/i18n/es";
import { fr } from "../../src/i18n/fr";
import { ja } from "../../src/i18n/ja";
import { pl } from "../../src/i18n/pl";
import { ptBR } from "../../src/i18n/pt-BR";
import { ru } from "../../src/i18n/ru";
import { zhCN } from "../../src/i18n/zh-CN";

type Texts = Record<string, Record<string, string>>;
const reference: Record<string, { id: number }[]> = JSON.parse(
  readFileSync(join(import.meta.dir, "../../codegen/reference-tables.json"), "utf8"),
);
const dictionaries = { fr, de, es, "pt-BR": ptBR, pl, ru, ja, "zh-CN": zhCN };
const ids = (texts: Texts | undefined) =>
  Object.fromEntries(Object.entries(texts ?? {}).map(([table, rows]) => [table, Object.keys(rows)]));

describe("igdb-kit/i18n", () => {
  test("English has a label for every row of the reference tables and the 97 descriptors", () => {
    for (const [table, rows] of Object.entries(en.labels as Texts)) {
      if (table === "age_rating_content_descriptions_v2" || table === "age_rating_content_description_types")
        continue;
      expect(Object.keys(rows).map(Number)).toEqual(
        (reference[table] ?? []).map((row) => row.id).sort((a, b) => a - b),
      );
    }
    expect(Object.keys(en.labels).length).toBe(27);
    expect(Object.keys(en.labels.age_rating_content_descriptions_v2 ?? {}).map(Number)).toEqual(
      Array.from({ length: 97 }, (_, i) => i + 1),
    );
  });

  for (const [locale, dictionary] of Object.entries(dictionaries))
    test(`${locale} translates every label and description`, () => {
      expect(dictionary.locale).toBe(locale);
      expect(ids(dictionary.labels as Texts)).toEqual(ids(en.labels as Texts));
      expect(ids(dictionary.descriptions as Texts)).toEqual(ids(en.descriptions as Texts));
      for (const texts of [dictionary.labels, dictionary.descriptions] as Texts[])
        for (const rows of Object.values(texts))
          for (const text of Object.values(rows)) {
            expect(text.trim()).toBe(text);
            expect(text).not.toMatch(/^$| {2}/);
          }
      // Two labels of a table differ unless they are the same in English (descriptors of several boards).
      for (const [table, rows] of Object.entries(dictionary.labels as Texts)) {
        if (table === "age_rating_content_descriptions_v2") continue;
        const english = (en.labels as Texts)[table] ?? {};
        const seen = new Map<string, string>();
        for (const [id, text] of Object.entries(rows)) {
          const other = seen.get(text);
          if (other !== undefined) expect(`${table} ${english[id]}`).toBe(`${table} ${english[other]}`);
          seen.set(text, id);
        }
      }
    });

  test("label() reads the user's language, then English", () => {
    const { label } = createLabels([fr, ja, ptBR]);
    expect(label("genres", Genre.RolePlayingRPG, "fr-FR")).toBe(fr.labels.genres?.[12] as string);
    expect(label("genres", 12, "fr-CA")).toBe(fr.labels.genres?.[12] as string);
    expect(label("genres", 12, "ja")).toBe(ja.labels.genres?.[12] as string);
    expect(label("genres", 12, "pt-PT")).toBe(ptBR.labels.genres?.[12] as string);
    expect(label("genres", 12, "de-DE")).toBe("Role-playing (RPG)");
    expect(label("genres", 12, "en-US")).toBe("Role-playing (RPG)");
    expect(label("genres", 12, "not a locale")).toBe("Role-playing (RPG)");
    expect(createLabels([zhCN]).label("genres", 12, "zh-TW")).toBe("Role-playing (RPG)");
    expect(createLabels([zhCN]).label("genres", 12, "zh")).toBe(zhCN.labels.genres?.[12] as string);
    expect(createLabels().label("platform_types", 4, "en")).toBe("Operating system");
    expect(createLabels().label("popularity_types", 6, "en")).toBe("Positive Reviews");
  });

  test("label() takes a row, and its own label for an id it does not know", () => {
    const { label } = createLabels([fr]);
    expect(label("genres", { id: 12, name: "Role-playing (RPG)" }, "fr")).toBe(
      fr.labels.genres?.[12] as string,
    );
    expect(label("genres", { id: 99, name: "New genre" }, "fr")).toBe("New genre");
    expect(label("game_types", { id: 99, type: "New type" }, "fr")).toBe("New type");
    expect(label("age_rating_content_descriptions_v2", { id: 999, description: "New" }, "fr")).toBe("New");
    expect(label("genres", 99, "fr")).toBeNull();
    expect(label("genres", { id: 99 }, "fr")).toBeNull();
    expect(label("genres", undefined, "fr")).toBeNull();
    expect(label("genres", null, "fr")).toBeNull();
  });

  test("a dictionary of your own overrides some labels; the locale's country comes first", () => {
    const mine: LabelDictionary = { locale: "fr", labels: { genres: { 12: "RPG" } } };
    const { label } = createLabels([mine, fr]);
    expect(label("genres", 12, "fr")).toBe("RPG");
    expect(label("genres", 4, "fr")).toBe(fr.labels.genres?.[4] as string);
    expect(label("themes", 1, "fr")).toBe(fr.labels.themes?.[1] as string);

    const portugal: LabelDictionary = {
      locale: "pt-PT",
      labels: { game_types: { 1: "Conteúdo adicional" } },
    };
    const labels = createLabels([ptBR, portugal]);
    expect(labels.label("game_types", GameType.DLC, "pt-PT")).toBe("Conteúdo adicional");
    expect(labels.label("game_types", 1, "pt-BR")).toBe(ptBR.labels.game_types?.[1] as string);

    const english: LabelDictionary = { locale: "en", labels: { genres: { 4: "Fighting game" } } };
    expect(createLabels([fr, english]).label("genres", 4, "en-GB")).toBe("Fighting game");
    expect(createLabels([english]).label("genres", 4, "de")).toBe("Fighting game");
  });

  test("description() and entries()", () => {
    const { description, entries } = createLabels([de]);
    expect(description("release_date_statuses", ReleaseDateStatus.FullRelease, "de-AT")).toBe(
      de.descriptions?.release_date_statuses?.[6] as string,
    );
    expect(description("release_date_statuses", 6, "en")).toBe(
      "A status of release where the game has gone gold. Typically this is referred to as 1.0.",
    );
    expect(description("collection_relation_types", { id: 99, description: "New" }, "de")).toBe("New");
    const sizes = entries("company_sizes", "de");
    expect(sizes.map((entry) => entry.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(sizes[0]?.label).toBe(de.labels.company_sizes?.[1] as string);
    expect(entries("genres", "en")).toContainEqual({ id: 12, label: "Role-playing (RPG)" });
  });
});
