// Keeps one GitHub release per version of each package in sync with its CHANGELOG.md: the release is
// tagged `<name>@<version>` on the commit that set that version in package.json, and its notes are
// the version's changelog section. Missing releases are created (oldest first, so the newest stays
// "Latest") and edited notes are updated. Run by release.yml on each push to main, once the release
// job is done; needs GH_TOKEN and the full git history. `--dry-run` prints what it would do without
// calling GitHub. A release that fails does not stop the others.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const dryRun = process.argv.includes("--dry-run");
const repo = process.env.GITHUB_REPOSITORY ?? "7IBO/igdb-kit";

const run = (command: string, args: string[], input?: string): string =>
  execFileSync(command, args, { encoding: "utf8", input, stdio: ["pipe", "pipe", "pipe"] }).trim();

/** Runs a gh command, returning its error output instead of throwing. */
function attempt(args: string[], input: string): string | undefined {
  try {
    run("gh", args, input);
    return undefined;
  } catch (error) {
    const { stderr, message } = error as { stderr?: string; message: string };
    return (stderr || message).trim();
  }
}

const head = run("git", ["rev-parse", "HEAD"]);
let failed = false;

/**
 * GitHub answers 403 "Resource not accessible by integration" when GITHUB_TOKEN creates the tag of a
 * version set by an older commit (seen backfilling 0.1.0 to 0.3.0). Those only warn, with the way to
 * create them; any other failure, or one on the pushed commit, fails the job.
 */
function report(tag: string, commit: string | undefined, error: string): void {
  if (commit !== undefined && commit !== head && /Resource not accessible by integration/.test(error)) {
    console.log(
      `::warning::${tag} needs a token allowed to tag older commits: run \`bun scripts/sync-releases.ts\` once with your own gh login. (${error})`,
    );
    return;
  }
  console.log(`::error::${tag}: ${error}`);
  failed = true;
}

interface Section {
  version: string;
  notes: string;
}

/** The `## <version>` sections of a changesets changelog, with their notes. */
function sections(changelog: string): Section[] {
  return changelog
    .split(/^## /m)
    .slice(1)
    .flatMap((part) => {
      const newline = part.indexOf("\n");
      const version = (newline === -1 ? part : part.slice(0, newline)).trim();
      if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) return [];
      return [{ version, notes: newline === -1 ? "" : part.slice(newline + 1).trim() }];
    });
}

const parts = (version: string) => version.split(/[.-]/).map((p) => (/^\d+$/.test(p) ? Number(p) : p));
function compareVersions(a: string, b: string): number {
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return (x[i] as number) - (y[i] as number);
  // A prerelease comes before its release.
  if (x.length !== y.length) return x.length > 3 ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The first commit whose package.json has this version: the one the release points to. */
function commitOf(dir: string, version: string): string | undefined {
  const log = run("git", [
    "log",
    "--reverse",
    "--format=%H",
    `-S"version": "${version}"`,
    "--",
    join(dir, "package.json"),
  ]);
  return log.split("\n")[0] || undefined;
}

const existing = new Map<string, string>();
if (!dryRun) {
  const lines = run("gh", [
    "api",
    "--paginate",
    `repos/${repo}/releases`,
    "--jq",
    ".[] | [.tag_name, .body] | @json",
  ]);
  for (const line of lines.split("\n").filter(Boolean)) {
    const [tag, body] = JSON.parse(line) as [string, string | null];
    existing.set(tag, body ?? "");
  }
}

for (const entry of readdirSync("packages")) {
  const dir = join("packages", entry);
  const changelogPath = join(dir, "CHANGELOG.md");
  if (!existsSync(changelogPath)) continue;
  const { name, private: isPrivate } = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  if (isPrivate) continue;
  const versions = sections(readFileSync(changelogPath, "utf8")).sort((a, b) =>
    compareVersions(a.version, b.version),
  );
  const latest = versions.filter((v) => !v.version.includes("-")).at(-1)?.version;

  for (const { version, notes } of versions) {
    const tag = `${name}@${version}`;
    const body = notes || `${name} ${version}`;
    const current = existing.get(tag);
    if (current !== undefined) {
      if (current.trim() === body) continue;
      console.log(`Updating the notes of ${tag}`);
      const error = dryRun
        ? undefined
        : attempt(["release", "edit", tag, "--repo", repo, "--notes-file", "-"], body);
      if (error) report(tag, undefined, error);
      continue;
    }
    const commit = commitOf(dir, version);
    if (!commit) {
      console.warn(`Skipping ${tag}: no commit sets version ${version} in ${dir}/package.json`);
      continue;
    }
    console.log(`Creating ${tag} on ${commit.slice(0, 7)}`);
    if (dryRun) continue;
    const error = attempt(
      [
        "release",
        "create",
        tag,
        "--repo",
        repo,
        "--target",
        commit,
        "--title",
        `${name} ${version}`,
        "--notes-file",
        "-",
        ...(version.includes("-") ? ["--prerelease"] : []),
        `--latest=${version === latest}`,
      ],
      body,
    );
    if (error) report(tag, commit, error);
  }
}

if (failed) process.exitCode = 1;
