// Generates src/generated/schema.ts from the official protobuf schema merged with the parsed API docs.
//
//   bun scripts/codegen.ts            regenerate from the committed codegen/igdbapi.proto
//   bun scripts/codegen.ts --fetch    download the latest proto first
//
// The proto is the source of truth for which fields exist and their types. The docs add descriptions,
// deprecation notices and the endpoint paths.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const protoPath = join(root, "codegen/igdbapi.proto");
const docsPath = join(root, "codegen/docs-fields.json");
const outPath = join(root, "src/generated/schema.ts");

const referencePath = join(root, "codegen/reference-tables.json");

/**
 * Small reference tables whose ids people hard-code (`game_type = 0`, `platforms = 48`). Each becomes
 * a constant object named after its entity, so `GameType.MainGame` is both a value and, through
 * declaration merging, the entity type of the `game_types` endpoint.
 */
const REFERENCE_TABLES: { name: string; endpoint: string; label: string; extra?: string }[] = [
  { name: "GameType", endpoint: "game_types", label: "type" },
  { name: "GameStatus", endpoint: "game_statuses", label: "status" },
  { name: "GameReleaseFormat", endpoint: "game_release_formats", label: "format" },
  { name: "Genre", endpoint: "genres", label: "name" },
  { name: "Theme", endpoint: "themes", label: "name" },
  { name: "GameMode", endpoint: "game_modes", label: "name" },
  { name: "PlayerPerspective", endpoint: "player_perspectives", label: "name" },
  { name: "Platform", endpoint: "platforms", label: "name", extra: "abbreviation" },
  { name: "PlatformType", endpoint: "platform_types", label: "name" },
  { name: "ExternalGameSource", endpoint: "external_game_sources", label: "name" },
  {
    name: "PopularityType",
    endpoint: "popularity_types",
    label: "name",
    extra: "external_popularity_source",
  },
  { name: "ReleaseDateRegion", endpoint: "release_date_regions", label: "region" },
  { name: "DateFormat", endpoint: "date_formats", label: "format" },
  { name: "WebsiteType", endpoint: "website_types", label: "type" },
  { name: "AgeRatingOrganization", endpoint: "age_rating_organizations", label: "name" },
  { name: "LanguageSupportType", endpoint: "language_support_types", label: "name" },
  { name: "CharacterGender", endpoint: "character_genders", label: "name" },
  { name: "CharacterSpecie", endpoint: "character_species", label: "name" },
];

type ReferenceRow = { id: number } & Record<string, string | number>;

if (process.argv.includes("--fetch")) {
  const res = await fetch("https://api.igdb.com/v4/igdbapi.proto");
  if (!res.ok) throw new Error(`Could not download igdbapi.proto: ${res.status}`);
  writeFileSync(protoPath, await res.text());

  const { TWITCH_CLIENT_ID: clientId, TWITCH_CLIENT_SECRET: clientSecret } = process.env;
  if (!clientId || !clientSecret) throw new Error("--fetch needs TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET");
  const { createIGDB } = await import("../src/client");
  const igdb = createIGDB({ clientId, clientSecret });
  const tables: Record<string, ReferenceRow[]> = {};
  for (const t of REFERENCE_TABLES) {
    const fields = ["id", t.label, t.extra].filter(Boolean).join(",");
    tables[t.endpoint] = (await igdb.raw(
      t.endpoint as never,
      `fields ${fields}; sort id asc; limit 500;`,
    )) as ReferenceRow[];
  }
  writeFileSync(referencePath, `${JSON.stringify(tables, null, 2)}\n`);
}

/** Endpoints that accept `search "..."`, per the "Search" reference section of the docs. */
const SEARCHABLE = new Set(["characters", "collections", "games", "platforms", "themes"]);
/** Proto wrapper messages that are not entities. */
const INTERNAL = new Set(["Count", "MultiQueryResult", "MultiQueryResultArray"]);
/** Endpoints in the proto but not in the docs. They answer 403 unless your access tier includes them. */
const TIER_RESTRICTED: Record<string, string> = {
  ContentSafetyRating: "content_safety_ratings",
  ContentSafetyRatingDimension: "content_safety_rating_dimensions",
  GameContentSafetyRating: "game_content_safety_ratings",
};

interface ProtoField {
  name: string;
  type: string;
  repeated: boolean;
  deprecated: boolean;
}
interface ProtoEnum {
  name: string;
  values: { name: string; value: number }[];
}
interface DocEntity {
  name: string;
  path: string;
  fields: { name: string; type: string; desc: string }[];
}

const proto = readFileSync(protoPath, "utf8");
const docs: DocEntity[] = JSON.parse(readFileSync(docsPath, "utf8"));

const messages = new Map<string, ProtoField[]>();
for (const m of proto.matchAll(/^message (\w+) \{([\s\S]*?)^\}/gm)) {
  const [, name, body] = m as unknown as [string, string, string];
  if (INTERNAL.has(name) || name.endsWith("Result")) continue;
  const fields: ProtoField[] = [];
  for (const f of body.matchAll(
    /^\s*(repeated\s+)?([\w.]+)\s+(\w+)\s*=\s*\d+(\s*\[deprecated\s*=\s*true\])?/gm,
  )) {
    fields.push({ repeated: !!f[1], type: f[2] as string, name: f[3] as string, deprecated: !!f[4] });
  }
  messages.set(name, fields);
}

const enums = new Map<string, ProtoEnum>();
for (const m of proto.matchAll(/^enum (\w+) \{([\s\S]*?)^\}/gm)) {
  const [, name, body] = m as unknown as [string, string, string];
  const values = [...body.matchAll(/^\s*(\w+)\s*=\s*(-?\d+)/gm)].map((v) => ({
    name: v[1] as string,
    value: Number(v[2]),
  }));
  enums.set(name, { name, values });
}

const endpointOf = new Map<string, string>(); // message name -> endpoint path
const docsByMessage = new Map<string, DocEntity>();
for (const d of docs) {
  const message = d.name.replace(/\s+/g, "");
  docsByMessage.set(message, d);
  if (messages.has(message)) endpointOf.set(message, d.path);
}
for (const [message, path] of Object.entries(TIER_RESTRICTED)) {
  if (messages.has(message)) endpointOf.set(message, path);
}
const warnings: string[] = [];
for (const name of messages.keys()) {
  if (!endpointOf.has(name)) warnings.push(`proto message ${name} has no documented endpoint`);
}
for (const d of docs) {
  if (!messages.has(d.name.replace(/\s+/g, "")))
    warnings.push(`documented endpoint ${d.path} has no proto message`);
}

const SCALARS: Record<string, string> = {
  string: "string",
  bool: "boolean",
  double: "number",
  float: "number",
  int32: "number",
  int64: "number",
  uint32: "number",
  uint64: "number",
  sint32: "number",
  sint64: "number",
  fixed32: "number",
  fixed64: "number",
  bytes: "string",
  "google.protobuf.Timestamp": "number",
};

function jsdoc(lines: string[], indent: string): string {
  const clean = lines.filter(Boolean).map((l) => l.replace(/\*\//g, "*\\/"));
  if (!clean.length) return "";
  if (clean.length === 1) return `${indent}/** ${clean[0]} */\n`;
  return `${indent}/**\n${clean.map((l) => `${indent} * ${l}`).join("\n")}\n${indent} */\n`;
}

/** Turns "DEPRECATED! Use organization instead" into a TS deprecation tag. */
function describe(field: ProtoField, doc: { desc: string; type: string } | undefined): string[] {
  const lines: string[] = [];
  const desc = doc?.desc?.trim() ?? "";
  const deprecatedInDocs = /^DEPRECATED!?/i.test(desc);
  if (desc && !deprecatedInDocs) lines.push(desc);
  if (field.type === "google.protobuf.Timestamp") lines.push("Unix timestamp in seconds.");
  if (field.deprecated || deprecatedInDocs) {
    const hint = desc.replace(/^DEPRECATED!?\s*/i, "");
    lines.push(`@deprecated${hint ? ` ${hint}` : ""}`);
  }
  return lines;
}

let out = `// Generated by scripts/codegen.ts from igdbapi.proto and the IGDB API docs. Do not edit by hand.
/* eslint-disable */

`;

/** The field named by "Use X instead" when X exists on the same message, else undefined. */
function replacementOf(fields: ProtoField[], desc: string): string | undefined {
  const name = /use (\w+) instead/i.exec(desc)?.[1];
  return fields.some((f) => f.name === name && !f.deprecated) ? name : undefined;
}

/**
 * Deprecated fields that IGDB replaced with another field or announced for removal. IGDB still
 * accepts them in queries but returns them empty or frozen (`where category = 0` matches no game), so
 * they are left out of the types and rejected at runtime with the name of their replacement.
 * Deprecated fields without a replacement are kept, tagged `@deprecated`.
 */
const removed = new Map<string, Map<string, string | null>>();
for (const [name, fields] of messages) {
  const docFields = new Map(docsByMessage.get(name)?.fields.map((f) => [f.name, f]) ?? []);
  for (const f of fields) {
    const desc = docFields.get(f.name)?.desc ?? "";
    if (!f.deprecated && !/^DEPRECATED/i.test(desc.trim())) continue;
    const replacement = replacementOf(fields, desc);
    if (replacement === undefined && !/to be removed/i.test(desc)) continue;
    if (!removed.has(name)) removed.set(name, new Map());
    removed.get(name)?.set(f.name, replacement ?? null);
  }
}
const isRemoved = (message: string, field: string) => removed.get(message)?.has(field) ?? false;

// Enums: a const object for values plus a union type. Every proto enum is a deprecated legacy enum;
// only those still used by a kept field are emitted.
const usedEnums = new Set(
  [...messages].flatMap(([name, fields]) =>
    fields.filter((f) => enums.has(f.type) && !isRemoved(name, f.name)).map((f) => f.type),
  ),
);
for (const e of enums.values()) {
  if (!usedEnums.has(e.name)) continue;
  const typeName = e.name;
  out += jsdoc(["@deprecated Legacy enum, replaced by a reference table in the API."], "");
  out += `export const ${typeName} = {\n${e.values.map((v) => `  ${v.name}: ${v.value},`).join("\n")}\n} as const;\n`;
  out += `export type ${typeName} = (typeof ${typeName})[keyof typeof ${typeName}];\n\n`;
}

// Entities: plain interfaces, relations typed as the target entity. The query layer turns a relation
// into an id (or id array) unless the relation is expanded in the selected fields.
const runtimeEntities: string[] = [];
for (const [name, fields] of messages) {
  const doc = docsByMessage.get(name);
  const docFields = new Map(doc?.fields.map((f) => [f.name, f]) ?? []);
  const endpoint = endpointOf.get(name);
  out += jsdoc(
    [
      endpoint ? `Entity of the \`${endpoint}\` endpoint.` : "",
      name in TIER_RESTRICTED
        ? "Not in the public docs: IGDB answers 403 unless your access tier includes it."
        : "",
    ],
    "",
  );
  out += `export interface ${name} {\n`;
  const meta: string[] = [];
  for (const f of fields) {
    if (isRemoved(name, f.name)) continue;
    let ts: string;
    let kind: string;
    if (f.type in SCALARS) {
      ts = SCALARS[f.type] as string;
      kind = "0";
    } else if (enums.has(f.type)) {
      ts = f.type;
      kind = "0";
    } else if (messages.has(f.type)) {
      ts = f.type;
      kind = JSON.stringify(f.type);
    } else {
      throw new Error(`Unknown proto type ${f.type} on ${name}.${f.name}`);
    }
    if (f.repeated) ts = `${ts}[]`;
    out += jsdoc(describe(f, docFields.get(f.name)), "  ");
    out += `  ${f.name}: ${ts};\n`;
    meta.push(`${f.name}:${kind}`);
  }
  out += "}\n\n";
  runtimeEntities.push(`  ${name}: {${meta.join(",")}},`);
}

/** "Sega Mega Drive/Genesis" -> "SegaMegaDriveGenesis", "Pokémon mini" -> "PokemonMini". */
function identifier(label: string): string {
  const words = label
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s*\([^)]*,[^)]*\)/g, "") // drop long explanations: "4X (explore, expand, ...)"
    .replace(/&/g, " And ")
    .replace(/\|/g, "")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  const id = words.map((w) => w[0]?.toUpperCase() + w.slice(1)).join("");
  return /^\d/.test(id) ? `_${id}` : id;
}

/** Spelling mistakes in IGDB labels, fixed in constant names only. */
const TYPOS: Record<string, string> = { Postitive: "Positive" };

const referenceTables: Record<string, ReferenceRow[]> = JSON.parse(readFileSync(referencePath, "utf8"));
const sourceNames = new Map((referenceTables.external_game_sources ?? []).map((r) => [r.id, String(r.name)]));
for (const t of REFERENCE_TABLES) {
  const rows = referenceTables[t.endpoint];
  if (!rows) throw new Error(`codegen/reference-tables.json has no ${t.endpoint}: run with --fetch`);
  if (!messages.has(t.name)) throw new Error(`Reference table ${t.name} is not an entity`);
  const used = new Set<string>();
  const members: string[] = [];
  for (const row of rows) {
    let label = String(row[t.label]);
    if (/^DUPLICATE\b/.test(label)) continue;
    for (const [typo, fix] of Object.entries(TYPOS)) label = label.replace(typo, fix);
    // Popularity types from another source than IGDB itself get its name: Steam24hrPeakPlayers.
    const source = t.extra === "external_popularity_source" ? sourceNames.get(Number(row[t.extra])) : "";
    let key = identifier(`${source ?? ""} ${label}`);
    if (used.has(key)) key = `${key}_${row.id}`;
    used.add(key);
    const extra = t.extra === "abbreviation" && row.abbreviation ? ` (${row.abbreviation})` : "";
    members.push(`  /** ${String(row[t.label]).replace(/\*\//g, "*\\/")}${extra} */\n  ${key}: ${row.id},`);
  }
  out += jsdoc(
    [
      `Ids of the \`${t.endpoint}\` reference table, for filters such as \`where(g => g.${t.endpoint === "platforms" ? "platforms.any" : "game_type.eq"}(...))\`.`,
      "IGDB can add rows at any time: regenerate with `bun run codegen --fetch`.",
    ],
    "",
  );
  out += `export const ${t.name} = {\n${members.join("\n")}\n} as const;\n\n`;
}

const endpointEntries = [...endpointOf.entries()].sort((a, b) => a[1].localeCompare(b[1]));
out += `/** Maps each endpoint path to the entity it returns. */
export interface Endpoints {
${endpointEntries.map(([m, p]) => `  ${p}: ${m};`).join("\n")}
}

export type EndpointName = keyof Endpoints;

/** Endpoints that support \`search "..."\`. */
export type SearchableEndpoint = ${[...SEARCHABLE].map((s) => JSON.stringify(s)).join(" | ")};

/**
 * Runtime schema used to validate field paths before a request is sent (an invalid field makes IGDB
 * reject a whole multiquery). Each field maps to 0 for a scalar or to the target entity name for a relation.
 */
export const entities: Record<string, Record<string, 0 | string>> = {
${runtimeEntities.join("\n")}
};

/** Fields IGDB replaced or dropped, with their replacement. They are no longer returned. */
export const removedFields: Record<string, Record<string, string | null>> = {
${[...removed].map(([m, fields]) => `  ${m}: {${[...fields].map(([f, r]) => `${f}:${JSON.stringify(r)}`).join(",")}},`).join("\n")}
};

export const endpoints: Record<EndpointName, { entity: string; searchable: boolean }> = {
${endpointEntries.map(([m, p]) => `  ${p}: { entity: ${JSON.stringify(m)}, searchable: ${SEARCHABLE.has(p)} },`).join("\n")}
};
`;

writeFileSync(outPath, out);
console.log(
  `Wrote ${outPath}: ${messages.size} entities, ${endpointOf.size} endpoints, ${usedEnums.size} enums (${(out.length / 1024).toFixed(0)} KB)`,
);
for (const w of warnings) console.warn(`warning: ${w}`);
