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

if (process.argv.includes("--fetch")) {
  const res = await fetch("https://api.igdb.com/v4/igdbapi.proto");
  if (!res.ok) throw new Error(`Could not download igdbapi.proto: ${res.status}`);
  writeFileSync(protoPath, await res.text());
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

// Enums: a const object for values plus a union type. Every proto enum is a deprecated legacy enum.
for (const e of enums.values()) {
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

export const endpoints: Record<EndpointName, { entity: string; searchable: boolean }> = {
${endpointEntries.map(([m, p]) => `  ${p}: { entity: ${JSON.stringify(m)}, searchable: ${SEARCHABLE.has(p)} },`).join("\n")}
};
`;

writeFileSync(outPath, out);
console.log(
  `Wrote ${outPath}: ${messages.size} entities, ${endpointOf.size} endpoints, ${enums.size} enums (${(out.length / 1024).toFixed(0)} KB)`,
);
for (const w of warnings) console.warn(`warning: ${w}`);
