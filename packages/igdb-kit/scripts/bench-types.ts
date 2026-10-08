// Measures what igdb-kit's type inference costs the TypeScript checker, on each supported TS version.
// Generates a file with N realistic `games` queries, then compares `tsc --extendedDiagnostics` with a
// baseline file that only imports the client.
//
//   bun scripts/bench-types.ts [queries=200]

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const dir = join(root, ".bench-types");
const count = Number(process.argv[2] ?? 200);

// Every query picks a different mix of paths, so the checker cannot reuse cached instantiations.
const PATHS = [
  "name",
  "summary",
  "rating",
  "first_release_date",
  "slug",
  "storyline",
  "total_rating",
  "hypes",
  "*",
  "cover.image_id",
  "cover.*",
  "genres.name",
  "platforms.name",
  "platforms.*",
  "platforms.platform_logo.image_id",
  "involved_companies.company.name",
  "involved_companies.developer",
  "involved_companies.company.logo.image_id",
  "release_dates.date",
  "release_dates.platform.name",
  "franchises.games.name",
  "dlcs.name",
  "expansions.cover.image_id",
  "similar_games.name",
  "similar_games.cover.image_id",
  "screenshots.image_id",
  "videos.video_id",
  "websites.url",
  "websites.type.type",
  "game_modes.name",
  "themes.name",
  "age_ratings.rating_category.rating",
  "collections.games.cover.image_id",
  "parent_game.name",
];

function pick(i: number): string {
  let seed = i * 2654435761;
  const chosen = new Set<string>();
  const size = 3 + (i % 6);
  while (chosen.size < size) {
    seed = (seed * 1103515245 + 12345) >>> 0;
    chosen.add(PATHS[seed % PATHS.length] as string);
  }
  return [...chosen].map((p) => JSON.stringify(p)).join(", ");
}

function queries(n: number): string {
  const lines: string[] = [];
  for (let i = 0; i < n; i++) {
    lines.push(
      `export const q${i} = igdb.games.select(${pick(i)}).where((g) => g.rating.gte(${i}).and(g.platforms.any(6, 48))).sort("rating", "desc").limit(10);`,
      `export async function use${i}() { const r = await q${i}.first(); return r?.id; }`,
    );
  }
  return lines.join("\n");
}

const header = `import { createIGDB } from "../src";\nconst igdb = createIGDB({ clientId: "x", clientSecret: "y" });\n`;
const compilers = {
  "5.9": join(root, "../../node_modules/typescript-5.9/bin/tsc"),
  "6.0": join(root, "../../node_modules/typescript-6.0/bin/tsc"),
  "7.0": join(root, "../../node_modules/typescript/bin/tsc"),
};

function measure(tsc: string, file: string) {
  const config = join(dir, `tsconfig.${file.split("/").pop()}.json`);
  writeFileSync(
    config,
    JSON.stringify({
      compilerOptions: {
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "Bundler",
        lib: ["ES2022", "DOM"],
        types: [],
      },
      files: [file],
    }),
  );
  const out = Bun.spawnSync([tsc, "--extendedDiagnostics", "-p", config], { cwd: root }).stdout.toString();
  const pick = (label: string) => {
    const m = out.match(new RegExp(`^${label}:\\s+([\\d.]+)`, "m"));
    return m ? Number(m[1]) : Number.NaN;
  };
  if (!/Check time/.test(out)) throw new Error(`tsc failed:\n${out.slice(0, 2000)}`);
  return { check: pick("Check time"), instantiations: pick("Instantiations"), memoryKB: pick("Memory used") };
}

mkdirSync(dir, { recursive: true });
try {
  const baseFile = join(dir, "baseline.ts");
  const benchFile = join(dir, "bench.ts");
  writeFileSync(baseFile, `${header}export { igdb };\n`);
  writeFileSync(benchFile, header + queries(count));
  console.log(`${count} queries on games (select with expansions, typed where, sort, first)\n`);
  console.log("TS    | check time (base -> with queries) | per query | instantiations added | memory added");
  for (const [version, tsc] of Object.entries(compilers)) {
    const base = measure(tsc, baseFile);
    const bench = measure(tsc, benchFile);
    const perQueryMs = ((bench.check - base.check) * 1000) / count;
    console.log(
      `${version.padEnd(5)} | ${base.check.toFixed(2)} s -> ${bench.check.toFixed(2)} s`.padEnd(42) +
        ` | ${perQueryMs.toFixed(2)} ms | ${(bench.instantiations - base.instantiations).toLocaleString("en")} | ${((bench.memoryKB - base.memoryKB) / 1024).toFixed(0)} MB`,
    );
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
