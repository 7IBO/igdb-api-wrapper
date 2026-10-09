// Checks the generated schema against the live API, field by field:
//   - the type of every returned value matches the proto (string, number, boolean, id, arrays),
//   - every field the API returns is in the schema (or was removed on purpose),
//   - which fields are never filled, and which deprecated fields still are,
//   - how much each replaced field is filled next to its replacement: a replaced field filled more
//     than its replacement must stay (codegen/kept-deprecated.json), a kept one can go once its
//     replacement catches up.
//
//   TWITCH_CLIENT_ID=… TWITCH_CLIENT_SECRET=… bun run audit > audit.md
//
// Prints a Markdown report and exits with 1 when a type mismatch or an unknown field is found.
// About 700 count queries, batched into multiqueries: a few minutes at IGDB's rate limit.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createIGDB, endpoints, entities, removedFields } from "../src";

const { TWITCH_CLIENT_ID: clientId, TWITCH_CLIENT_SECRET: clientSecret } = process.env;
if (!clientId || !clientSecret) throw new Error("audit needs TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET");
const igdb = createIGDB({ clientId, clientSecret });

// JS type IGDB returns for each proto field: relations and enums come back as numeric ids.
const proto = readFileSync(join(import.meta.dir, "../codegen/igdbapi.proto"), "utf8");
const SCALAR_KIND: Record<string, string> = { string: "string", bool: "boolean", bytes: "string" };
const expected = new Map<string, string>();
for (const m of proto.matchAll(/^message (\w+) \{([\s\S]*?)^\}/gm)) {
  for (const f of (m[2] as string).matchAll(/^\s*(repeated\s+)?([\w.]+)\s+(\w+)\s*=/gm)) {
    const kind = SCALAR_KIND[f[2] as string] ?? "number";
    expected.set(`${m[1]}.${f[3]}`, f[1] ? `${kind}[]` : kind);
  }
}

/** Deprecated fields kept because IGDB fills them more than their replacement. */
const kept: Record<string, Record<string, { replacement: string }>> = JSON.parse(
  readFileSync(join(import.meta.dir, "../codegen/kept-deprecated.json"), "utf8"),
);

const kindOf = (v: unknown) => (Array.isArray(v) ? `${v.length ? typeof v[0] : "number"}[]` : typeof v);
const count = (path: string, where: string) =>
  igdb
    .raw(`${path}/count` as never, where ? `where ${where};` : "")
    .then((r) => (r as { count: number }).count);

const errors: string[] = [];
const never: string[] = [];
const deprecatedAlive: string[] = [];
const replacements: string[] = [];
const skipped: string[] = [];
let checked = 0;

for (const [endpoint, { entity }] of Object.entries(endpoints)) {
  const fields = Object.keys(entities[entity] ?? {}).filter((f) => f !== "id");
  let total: number;
  try {
    total = await count(endpoint, "");
  } catch (error) {
    skipped.push(`\`${endpoint}\`: ${(error as Error).name}`);
    continue;
  }
  if (total === 0) continue;
  const [filled, sample] = await Promise.all([
    Promise.all(fields.map((f) => count(endpoint, `${f} != null`))),
    Promise.all(
      ["asc", "desc"].map((d) => igdb.raw(endpoint as never, `fields *; sort id ${d}; limit 200;`)),
    ).then((pages) => pages.flat() as Record<string, unknown>[]),
  ]);
  fields.forEach((field, i) => {
    checked++;
    if (filled[i] === 0) never.push(`\`${endpoint}.${field}\``);
    const want = expected.get(`${entity}.${field}`);
    const got = new Set(
      sample
        .map((row) => row[field])
        .filter((v) => v !== undefined)
        .map(kindOf),
    );
    for (const kind of got) {
      if (kind !== want) errors.push(`\`${endpoint}.${field}\` is typed ${want} but IGDB returned ${kind}`);
    }
  });
  const removed = removedFields[entity] ?? {};
  const pairs = [
    ...Object.entries(removed).flatMap(([field, replacement]) =>
      replacement ? [{ field, replacement, status: "rejected" }] : [],
    ),
    ...Object.entries(kept[entity] ?? {}).map(([field, { replacement }]) => ({
      field,
      replacement,
      status: "kept",
    })),
  ];
  const fills = await Promise.all(
    pairs.map((p) =>
      Promise.all([count(endpoint, `${p.field} != null`), count(endpoint, `${p.replacement} != null`)]),
    ),
  );
  pairs.forEach(({ field, replacement, status }, i) => {
    const [old = 0, current = 0] = fills[i] ?? [];
    const share = (n: number) => `${((100 * n) / total).toFixed(1)}%`;
    const line = `\`${endpoint}.${field}\` ${share(old)}, \`${replacement}\` ${share(current)}`;
    replacements.push(`${line} (${status})`);
    if (status === "rejected" && old > current)
      errors.push(`${line}: the replaced field holds more, keep it (codegen/kept-deprecated.json)`);
    if (status === "kept" && current >= old)
      errors.push(`${line}: the replacement caught up, drop codegen/kept-deprecated.json's entry`);
  });
  for (const key of new Set(sample.flatMap((row) => Object.keys(row)))) {
    if (key === "id" || key in (entities[entity] ?? {})) continue;
    if (key in removed)
      deprecatedAlive.push(`\`${endpoint}.${key}\` (replaced by \`${removed[key] ?? "nothing"}\`)`);
    else errors.push(`\`${endpoint}.${key}\` is returned by IGDB but missing from the schema`);
  }
}

const list = (items: string[]) => (items.length ? items.map((i) => `- ${i}`).join("\n") : "- none");
console.log(`## Schema audit against the live API

${checked} fields checked on ${Object.keys(endpoints).length - skipped.length} endpoints.

### Problems
${list(errors)}

### Never filled (kept: not deprecated, IGDB may fill them later)
${list(never)}

### Replaced fields IGDB still returns (rejected by igdb-kit; use the replacement)
${list(deprecatedAlive)}

### Replaced fields next to their replacement (share of rows filled)
${list(replacements)}

### Skipped endpoints
${list(skipped)}
`);
process.exit(errors.length ? 1 : 0);
