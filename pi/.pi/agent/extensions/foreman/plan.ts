import { stat } from "node:fs/promises";
import { resolve } from "node:path";

export type PlanInput = { kind: "prd"; path: string } | { kind: "idea"; text: string };

/** `/foreman plan <idea | path>`: an existing file is a PRD, anything else is the idea itself. */
export async function resolvePlanInput(argument: string, cwd: string): Promise<PlanInput> {
  const value = argument.trim();
  if (!value) throw new Error("Usage: /foreman plan <idea, intent, or path to a PRD>");
  if (!/\s/.test(value)) {
    const candidate = resolve(cwd, value);
    const found = await stat(candidate).catch(() => undefined);
    if (found?.isFile()) return { kind: "prd", path: candidate };
  }
  return { kind: "idea", text: value };
}

/**
 * The Architect runs in the owner's current session, so its role instructions travel in the first
 * message. (A fresh session would reset the model and re-create this extension's runtime.)
 */
export function architectKickoff(input: PlanInput, checkCommand: string, roleInstructions = "", notes: string[] = [], webGuidePath?: string): string {
  const source = input.kind === "prd"
    ? `The owner supplied a PRD at ${input.path}. Read it first.`
    : `The owner's request:\n\n${input.text}`;
  return [
    ...(roleInstructions.trim() ? ["# Your role", roleInstructions.trim(), "", "# This request", ""] : []),
    "Act as the Architect.",
    source,
    "",
    ...(notes.length ? ["", "Facts about this machine (plan around them; put anything a task needs into its goal text):", ...notes.map((note) => `- ${note}`), ""] : []),
    ...(webGuidePath ? [`If the app has a web UI (pages, browser tests), read ${webGuidePath} before writing the tasks. Otherwise ignore it.`, ""] : []),
    "Follow your role instructions. Write `foreman/plan.md` and `foreman/tasks.yaml` in the repository root.",
    `Validate the task list with this exact command and keep fixing until it prints OK:\n\n    ${checkCommand}`,
  ].join("\n");
}
