import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { basename, dirname, join } from "node:path";
import { parsePreviewConfig } from "./preview.ts";
import { loadTasks } from "./tasks.ts";

/** Human-readable validation report. `ok` is true only when there are no errors. */
export async function checkFile(path: string): Promise<{ ok: boolean; report: string }> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error: any) {
    return { ok: false, report: `Cannot read ${path}: ${error?.message ?? error}` };
  }
  const { tasks, errors } = loadTasks(text);
  if (errors.length) return { ok: false, report: `${errors.length} problem(s) in ${path}:\n${errors.map((error) => `  - ${error}`).join("\n")}` };
  const summary = `OK: ${tasks.length} task(s): ${tasks.map((task) => task.id).join(", ")}`;
  // A web app also needs preview.json (next to tasks.yaml) so the owner can watch it being built.
  const previewText = await readFile(join(dirname(path), "preview.json"), "utf8").catch(() => undefined);
  if (previewText === undefined) {
    // Browser-tested apps need a preview so the owner can watch them being built. Checked here, not
    // carried as a prompt rule: the validator tells the Architect exactly what to add.
    if (tasks.some((task) => task.successTests.some((command) => /playwright/i.test(command)))) {
      const guide = fileURLToPath(new URL("./agents/architect-web.md", import.meta.url));
      return { ok: false, report: `Browser (Playwright) tests found, but there is no preview.json next to ${basename(path)}. Read ${guide} and create ${join(dirname(path), "preview.json")}.` };
    }
    return { ok: true, report: summary };
  }
  const preview = parsePreviewConfig(previewText);
  if (!preview.config) return { ok: false, report: `preview.json has ${preview.errors.length} problem(s):\n${preview.errors.map((error) => `  - ${error}`).join("\n")}` };
  return { ok: true, report: `${summary}\npreview.json OK: ${preview.config.command} on port ${preview.config.port}` };
}

// CLI entry: `node check.ts foreman/tasks.yaml`. The Architect runs this to self-validate.
// Compare real paths: the extension is usually reached through a symlink (~/.pi -> dotfiles), and a
// mismatch here would exit 0 without printing, which reads as a passing check.
const invoked = process.argv[1] ? realpathSync(process.argv[1]) : undefined;
if (invoked && realpathSync(fileURLToPath(import.meta.url)) === invoked) {
  const { ok, report } = await checkFile(process.argv[2] ?? "foreman/tasks.yaml");
  console.log(report);
  process.exit(ok ? 0 : 1);
}
