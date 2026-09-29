import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
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
  return { ok: true, report: `OK: ${tasks.length} task(s): ${tasks.map((task) => task.id).join(", ")}` };
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
