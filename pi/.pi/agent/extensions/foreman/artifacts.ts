import { copyFile, mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";

export interface Collected {
  dir: string;
  videos: number;
  screenshots: number;
  traces: number;
  /** Files left out because the size cap was reached. */
  skipped: number;
  bytes: number;
}

const VIDEO = new Set([".webm", ".mp4"]);
const IMAGE = new Set([".png", ".jpg", ".jpeg"]);
const TRACE = new Set([".zip"]);
const extension = (name: string) => name.slice(name.lastIndexOf(".")).toLowerCase();

async function walk(directory: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...(await walk(path)));
    else if (entry.isFile()) found.push(path);
  }
  return found.sort();
}

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const encodePath = (path: string) => path.split("/").map(encodeURIComponent).join("/");

/**
 * Copy Playwright's videos, screenshots and traces out of `test-results` (which the next test run wipes)
 * into `dest`, and write an `index.html` to browse them. Returns undefined when nothing was recorded.
 */
export async function collectArtifacts(repo: string, dest: string, options: { maxBytes?: number } = {}): Promise<Collected | undefined> {
  const source = join(repo, "test-results");
  const maxBytes = options.maxBytes ?? 300 * 1024 * 1024;
  const media = (await walk(source)).filter((path) => [...VIDEO, ...IMAGE, ...TRACE].includes(extension(path)));
  if (media.length === 0) return undefined;

  const result: Collected = { dir: dest, videos: 0, screenshots: 0, traces: 0, skipped: 0, bytes: 0 };
  const copied: { rel: string; kind: "video" | "image" | "trace" }[] = [];
  for (const path of media) {
    const size = (await stat(path)).size;
    if (result.bytes + size > maxBytes) {
      result.skipped += 1;
      continue;
    }
    const rel = relative(source, path).split("\\").join("/");
    await mkdir(dirname(join(dest, rel)), { recursive: true });
    await copyFile(path, join(dest, rel));
    result.bytes += size;
    const ext = extension(path);
    if (VIDEO.has(ext)) { result.videos += 1; copied.push({ rel, kind: "video" }); }
    else if (IMAGE.has(ext)) { result.screenshots += 1; copied.push({ rel, kind: "image" }); }
    else { result.traces += 1; copied.push({ rel, kind: "trace" }); }
  }

  const groups = new Map<string, typeof copied>();
  for (const item of copied) {
    const group = item.rel.includes("/") ? item.rel.slice(0, item.rel.indexOf("/")) : "(top level)";
    groups.set(group, [...(groups.get(group) ?? []), item]);
  }
  const sections = [...groups].map(([group, items]) => `<section><h2>${escapeHtml(group)}</h2>${items.map((item) => {
    const url = encodeURI(encodePath(item.rel)).replace(/%25/g, "%");
    const label = escapeHtml(basename(item.rel));
    if (item.kind === "video") return `<figure><video controls preload="metadata" src="${url}"></video><figcaption>${label}</figcaption></figure>`;
    if (item.kind === "image") return `<figure><img loading="lazy" src="${url}" alt="${label}"><figcaption>${label}</figcaption></figure>`;
    return `<p><a href="${url}">${label}</a> <small>trace: open with <code>npx playwright show-trace ${label}</code></small></p>`;
  }).join("")}</section>`).join("\n");
  await writeFile(join(dest, "index.html"), `<!doctype html>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Foreman recordings · ${escapeHtml(basename(dest))}</title>
<style>
:root{color-scheme:light dark;font-family:system-ui,sans-serif}
body{margin:0 auto;max-width:1100px;padding:16px}
h1{font-size:1.2rem} h2{font-size:1rem;margin:1.5rem 0 .5rem;word-break:break-all}
figure{margin:0 0 1rem} video,img{max-width:100%;border:1px solid #8884;border-radius:6px}
figcaption,small{color:#888}
</style>
<h1>${escapeHtml(basename(dest))} · ${describeArtifacts(result)}</h1>
${sections}
`);
  return result;
}

export function describeArtifacts(result: Collected): string {
  const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
  const parts = [plural(result.videos, "video"), plural(result.screenshots, "screenshot"), plural(result.traces, "trace")].filter((part) => !part.startsWith("0 "));
  return `recorded ${parts.join(", ") || "nothing"}${result.skipped ? ` (skipped ${result.skipped} over the size cap)` : ""}`;
}

/** Recording folders under `foreman/.run/artifacts`, newest first, optionally only those of a task. */
export async function findRecordings(repo: string, taskPrefix?: string): Promise<{ name: string; index: string; modified: number }[]> {
  const root = join(repo, "foreman/.run/artifacts");
  const entries: { name: string; index: string; modified: number }[] = [];
  for (const entry of await readdir(root, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isDirectory() || (taskPrefix && !entry.name.startsWith(taskPrefix))) continue;
    const index = join(root, entry.name, "index.html");
    const info = await stat(index).catch(() => undefined);
    if (info) entries.push({ name: entry.name, index, modified: info.mtimeMs });
  }
  return entries.sort((a, b) => b.modified - a.modified);
}
