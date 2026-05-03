import type { ForgeTask } from "./types.ts";
import { normalizeValidationContract, assertSafeValidationCommand } from "./validation.ts";

export interface PreflightCheckResult {
  ok: boolean;
  kind?:
    | "environment_missing_runtime"
    | "environment_wrong_working_directory"
    | "environment_dependency_unreachable"
    | "environment_cors_misconfiguration"
    | "environment_native_binary_mismatch"
    | "environment_invalid_test_contract";
  reason?: string;
  suggestion?: string;
  normalizedCommand?: string;
  message?: string;
}

export function normalizeFrontendContainerCommand(command: string | undefined): string | undefined {
  if (!command) return command;

  let normalized = command;
  if (/docker compose exec\s+-T?\s*frontend-dev/.test(normalized) || /docker compose exec\s+frontend-dev/.test(normalized)) {
    normalized = normalized.replace(/frontend\/src\//g, "src/");
    normalized = normalized.replace(/frontend\/tests\//g, "tests/");
    normalized = normalized.replace(/\bcd\s+frontend\s*&&\s*/g, "");
  }
  return normalized;
}

export function classifyRuntimeFailure(text: string | undefined): PreflightCheckResult | null {
  const normalized = String(text ?? "").toLowerCase();

  const checks: Array<Omit<PreflightCheckResult, "ok" | "normalizedCommand">> = [
    {
      kind: "environment_missing_runtime",
      reason: "Acceptance environment is missing a required runtime tool or script.",
      suggestion: "Install or expose the missing CLI/script inside the execution environment before retrying.",
    },
    {
      kind: "environment_wrong_working_directory",
      reason: "Acceptance command uses paths inconsistent with the execution working directory.",
      suggestion: "Normalize file paths to the container/project working directory before retrying.",
    },
    {
      kind: "environment_dependency_unreachable",
      reason: "A required dependent service is unreachable from the execution environment.",
      suggestion: "Start or repair the dependent service and verify network reachability before retrying.",
    },
    {
      kind: "environment_cors_misconfiguration",
      reason: "Browser-origin requests are blocked by backend CORS policy.",
      suggestion: "Allow the frontend dev origin in backend CORS configuration before retrying.",
    },
    {
      kind: "environment_native_binary_mismatch",
      reason: "A native dependency was built for the wrong target platform.",
      suggestion: "Reinstall or rebuild native dependencies inside the runtime container/system before retrying.",
    },
    {
      kind: "environment_invalid_test_contract",
      reason: "Acceptance contract is not executable as currently specified.",
      suggestion: "Correct the acceptance signal or test harness assumptions before retrying.",
    },
  ];

  if (/playwright: not found|command not found|missing script|exit:\s*127/.test(normalized)) {
    return { ok: false, ...checks[0] };
  }
  if (/could not find .*frontend\/src|no tests found|working directory|cd frontend failed/.test(normalized)) {
    return { ok: false, ...checks[1] };
  }
  if (/econnrefused|fetch failed|net::err_failed|failed to fetch|service.*unreachable/.test(normalized)) {
    return { ok: false, ...checks[2] };
  }
  if (/cors|access-control-allow-origin|preflight request/.test(normalized)) {
    return { ok: false, ...checks[3] };
  }
  if (/exec format error|err_dlopen_failed|another platform|platform-specific binary|esbuild.*platform|better-sqlite3.*exec format error/.test(normalized)) {
    return { ok: false, ...checks[4] };
  }
  if (/acceptance signal did not run successfully|acceptance criteria cannot be confirmed/.test(normalized)) {
    return { ok: false, ...checks[5] };
  }

  return null;
}

function taskLooksLikeManualValidationCandidate(task: Pick<ForgeTask, "title" | "description" | "outputManifest">) {
  const manifest = Array.isArray(task.outputManifest) ? task.outputManifest : [];
  const haystack = `${task.title}\n${task.description}\n${manifest.join("\n")}`.toLowerCase();
  const mentionsDocs = /\breadme\b|\bdocs?\b|documentation|troubleshooting|guide|note/.test(haystack);
  const manifestLooksTextual = manifest.length > 0
    && manifest.every((file: string) => /\.(md|mdx|txt|json|ya?ml|toml)$/i.test(file));
  return mentionsDocs || manifestLooksTextual;
}

function missingAcceptanceSuggestion(task: Pick<ForgeTask, "id" | "title" | "description" | "outputManifest">) {
  if (taskLooksLikeManualValidationCandidate(task)) {
    return [
      "This task looks like a documentation/config/manual-review task.",
      "Either add an executable acceptance signal, or resolve the blocker with a manual validation instruction.",
      `Example: /forge blocker ${task.id} --resolve \"Validate by checking that the intended text/config change is present and coherent; no executable acceptance command is required for this task.\"`,
    ].join(" ");
  }

  return [
    "Define an executable acceptance signal before task execution.",
    `Example: /forge blocker ${task.id} --resolve \"Use the correct project test or verification command for ${task.title}.\"`,
  ].join(" ");
}

export function preflightAcceptanceCommand(
  task: Pick<ForgeTask, "id" | "title" | "description" | "outputManifest" | "validation">
    & Partial<Pick<ForgeTask, "acceptanceSignal" | "testCommand" | "coverageThreshold">>
): PreflightCheckResult {
  let validation;
  try {
    validation = normalizeValidationContract({
      validation: task.validation,
      testCommand: task.testCommand,
      acceptanceSignal: task.acceptanceSignal,
      coverageThreshold: task.coverageThreshold,
    }).validation;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("mode=command requires a non-empty validation.command")) {
      return {
        ok: false,
        kind: "environment_invalid_test_contract",
        reason: "Command validation mode requires an executable validation.command, but none was provided.",
        suggestion: [
          "Set validation.command to the exact test or verification command to run during preflight and validation.",
          `Example: add validation: { mode: \"command\", command: \"<your-test-command>\" } to task ${task.id}.`,
        ].join(" "),
      };
    }

    return {
      ok: false,
      kind: "environment_invalid_test_contract",
      reason: message,
      suggestion: missingAcceptanceSuggestion(task),
    };
  }

  if (validation.mode === "manual") {
    return {
      ok: true,
      message: "Preflight skipped executable command checks because validation.mode=manual.",
    };
  }

  const normalizedCommand = normalizeFrontendContainerCommand(validation.command);
  if (!normalizedCommand) {
    return {
      ok: false,
      kind: "environment_invalid_test_contract",
      reason: "Command validation mode requires an executable validation.command, but none was provided.",
      suggestion: [
        "Set validation.command to the exact test or verification command to run during preflight and validation.",
        `Example: add validation: { mode: \"command\", command: \"<your-test-command>\" } to task ${task.id}.`,
      ].join(" "),
    };
  }

  try {
    assertSafeValidationCommand(normalizedCommand);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      kind: "environment_invalid_test_contract",
      reason: message,
      suggestion: "Correct the validation command to a supported Node-based test command before retrying.",
      normalizedCommand,
    };
  }

  if (/docker compose exec\s+frontend-dev/.test(normalizedCommand) && /frontend\/src\//.test(normalizedCommand)) {
    return {
      ok: false,
      kind: "environment_wrong_working_directory",
      reason: "frontend-dev commands must use paths relative to the frontend root inside the container.",
      suggestion: "Strip the leading frontend/ prefix and rerun the command from /app.",
      normalizedCommand,
    };
  }

  return {
    ok: true,
    normalizedCommand,
    message: `Preflight validated executable command checks for validation.mode=${validation.mode}.`,
  };
}
