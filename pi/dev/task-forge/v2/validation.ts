// @ts-nocheck
import type { TaskValidationResult } from "./task-success.ts";
import type { TaskValidationContract, ValidationMode } from "./types.ts";

export type { TaskValidationContract, ValidationMode } from "./types.ts";

export interface ValidationContractShape {
  mode?: ValidationMode;
  command?: string;
  notes?: string;
  coverageThreshold?: number;
}

export interface ValidationExecResult {
  code: number;
  stdout?: string;
  stderr?: string;
}

export interface ValidationTaskLike {
  validation?: TaskValidationContract;
  testCommand?: string;
  acceptanceSignal?: string;
  coverageThreshold?: number;
  validationOutput?: string;
  validationFramework?: string;
  lastCoverage?: number;
}

export interface ValidationContractInput {
  validation?: ValidationContractShape | null;
  testCommand?: string;
  acceptanceSignal?: string;
  coverageThreshold?: number;
  legacyAdapterEnabled?: boolean;
}

export interface GeneratedValidationContractInput extends ValidationContractInput {
  source: "planner" | "test-designer";
}

export interface NormalizedValidationContractResult {
  validation: TaskValidationContract;
  usedLegacyFields: string[];
  warnings: string[];
}

export interface ValidationLegacyFields {
  testCommand?: string;
  acceptanceSignal?: string;
  coverageThreshold?: number;
}

export interface ValidationHooks {
  exec: (command: string) => Promise<ValidationExecResult>;
}

function normalizeBareTypecheckThenNodeTestCommand(command: string): string {
  const match = command.match(/^\s*((?:npx\s+)?tsc\s+[^&\n]+?)\s*&&\s*(node\s+--test[^\n]+)\s*$/i);
  if (!match) return command;

  const tscPart = match[1].trim();
  const nodePart = match[2].trim();

  const hasProject = /(?:^|\s)(?:-p|--project)\b/i.test(tscPart);

  // If tsc already references a project, the user knows what they're doing.
  if (hasProject) return command;

  // Without a project flag, tsc --noEmit <files> is unreliable because it
  // ignores tsconfig.json (e.g. allowImportingTsExtensions, esModuleInterop).
  // The node --test --experimental-strip-types runner already validates syntax.
  // Strip the tsc prefix and keep only the node --test command.
  return nodePart;
}

export function normalizeValidationCommand(command?: string): string | undefined {
  if (!command) return undefined;
  let normalized = command.trim();
  normalized = normalized.replace(/\s+exits?\s+0\s*$/i, "");
  normalized = normalized.replace(/\s+returns?\s+0\s*$/i, "");
  normalized = normalized.replace(/^command:\s*/i, "");
  normalized = normalizeBareTypecheckThenNodeTestCommand(normalized);
  return normalized.trim() || undefined;
}

export function normalizeValidationNotes(notes?: string): string | undefined {
  const normalized = typeof notes === "string" ? notes.trim() : "";
  return normalized || undefined;
}

function isBareTypecheckCommand(command: string): boolean {
  const trimmed = command.trim();
  // Match standalone tsc or npx tsc commands (no trailing && ...)
  const match = trimmed.match(/^\s*(npx\s+)?tsc\s+[^&\n]*$/i);
  if (!match) return false;
  const hasProject = /(?:^|\s)(?:-p|--project)\b/i.test(trimmed);
  return !hasProject;
}

function containsShellOperators(command: string): boolean {
  return /(&&|\|\||\||;|`|\$\(|\$\{)/.test(command);
}

function containsBarePath(command: string): boolean {
  return /^\.{0,2}\/|[\s;|]&?\.\.?\//.test(command);
}

export function assertSafeValidationCommand(command: string): void {
  const normalized = normalizeValidationCommand(command);
  if (!normalized) {
    throw new Error("Unsafe validation command: empty command. Provide a single Node-based test command such as `npm test`, `pnpm test`, `node --test`, or `npx vitest run`.");
  }

  if (/^deno\b/i.test(normalized)) {
    throw new Error("Deno is not supported as an active TaskForge test engine. Use Node-based commands such as `npm test`, `pnpm test`, `node --test`, or `npx vitest run`.");
  }

  if (containsShellOperators(normalized)) {
    throw new Error("Unsafe validation command: shell operators (&&, ||, |, ;, `, $() ) are not allowed. Use a single test command or define a package script.");
  }

  if (containsBarePath(normalized)) {
    throw new Error("Unsafe validation command: relative or absolute paths are not allowed. Use a package manager script or `npx <tool>`.");
  }

  if (isBareTypecheckCommand(normalized)) {
    throw new Error("Unsafe validation command: bare `tsc --noEmit` ignores tsconfig.json. Use `node --test` for type-aware testing, or add `--project tsconfig.json` if type-checking is required.");
  }
}

export function summarizeValidationEvidence(fullOutput: string, maxLines = 8): string {
  const lines = fullOutput.split("\n");

  const isNoise = (line: string): boolean => {
    const trimmed = line.trim();
    if (!trimmed) return true;
    const lower = trimmed.toLowerCase();
    if (/^usage:/i.test(trimmed)) return true;
    if (/^options:/i.test(trimmed)) return true;
    if (/^examples:/i.test(trimmed)) return true;
    if (/^arguments:/i.test(trimmed)) return true;
    if (/^flags:/i.test(trimmed)) return true;
    if (/^\s*-/i.test(trimmed) && !trimmed.includes(":")) return true; // standalone flags
    if (/^tsc: the TypeScript compiler/i.test(trimmed)) return true;
    if (/^syntax: /i.test(trimmed)) return true;
    if (/^\[\d+m?s?\]\s*$/i.test(trimmed)) return true;
    if (lower.includes("for detailed help") || lower.includes("--help") || lower.includes("-h")) return true;
    return false;
  };

  const filtered = lines.filter((line) => !isNoise(line));

  if (filtered.length <= maxLines) {
    return filtered.join("\n");
  }

  const head = filtered.slice(0, Math.ceil(maxLines / 2));
  const tail = filtered.slice(-Math.floor(maxLines / 2));
  return [
    ...head,
    `\n... ${filtered.length - head.length - tail.length} lines omitted; full log preserved in artifact ...\n`,
    ...tail,
  ].join("\n");
}

export function looksLikeValidationCommand(value?: string): boolean {
  const normalized = normalizeValidationCommand(value);
  if (!normalized) return false;
  if (/\n/.test(normalized)) return false;
  if (/(&&|\|\||\||;|`|\$\(|^\.?\/)/.test(normalized)) return true;
  return /^(npm|pnpm|yarn|bun|node|npx|python|python3|pytest|vitest|jest|go|cargo|make|just|bash|sh|git|docker|uv|php|composer)\b/i.test(normalized);
}

function coerceCoverageThreshold(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    throw new Error(`Invalid validation contract: coverageThreshold must be a non-negative number; received ${JSON.stringify(value)}`);
  }
  return numeric;
}

export function assertValidValidationContract(validation: ValidationContractShape): TaskValidationContract {
  const command = normalizeValidationCommand(validation.command);
  const notes = normalizeValidationNotes(validation.notes);
  const coverageThreshold = coerceCoverageThreshold(validation.coverageThreshold);

  if (validation.mode !== "command" && validation.mode !== "manual") {
    throw new Error(`Invalid validation contract: mode must be \"command\" or \"manual\"; received ${JSON.stringify(validation.mode)}`);
  }

  if (validation.mode === "command") {
    if (!command) {
      throw new Error("Invalid validation contract: mode=command requires a non-empty validation.command");
    }
    return {
      mode: "command",
      command,
      notes,
      coverageThreshold,
    };
  }

  if (!notes) {
    throw new Error("Invalid validation contract: mode=manual requires non-empty validation.notes");
  }
  if (command) {
    throw new Error("Invalid validation contract: mode=manual cannot include validation.command");
  }
  if (coverageThreshold !== undefined) {
    throw new Error("Invalid validation contract: mode=manual cannot include validation.coverageThreshold");
  }

  return {
    mode: "manual",
    notes,
  };
}

export function normalizeValidationContract(input: ValidationContractInput): NormalizedValidationContractResult {
  const warnings: string[] = [];
  const legacyFieldNames = [
    ...(input.testCommand ? ["testCommand"] : []),
    ...(input.acceptanceSignal ? ["acceptanceSignal"] : []),
    ...(input.coverageThreshold !== undefined ? ["coverageThreshold"] : []),
  ];

  if (input.validation) {
    if (legacyFieldNames.length > 0) {
      warnings.push(`Typed validation is authoritative; ignoring legacy fields: ${legacyFieldNames.join(", ")}.`);
    }
    return {
      validation: assertValidValidationContract(input.validation),
      usedLegacyFields: [],
      warnings,
    };
  }

  if (input.legacyAdapterEnabled === false) {
    throw new Error("Invalid validation contract: legacy compatibility adapter is disabled and validation is required");
  }

  const legacyCommand = normalizeValidationCommand(input.testCommand)
    ?? (looksLikeValidationCommand(input.acceptanceSignal) ? normalizeValidationCommand(input.acceptanceSignal) : undefined);
  const legacyNotes = input.acceptanceSignal && !legacyCommand
    ? normalizeValidationNotes(input.acceptanceSignal)
    : undefined;
  const coverageThreshold = coerceCoverageThreshold(input.coverageThreshold);

  if (legacyCommand) {
    const usedLegacyFields = [
      ...(input.testCommand ? ["testCommand"] : []),
      ...(!input.testCommand && input.acceptanceSignal ? ["acceptanceSignal"] : []),
      ...(coverageThreshold !== undefined ? ["coverageThreshold"] : []),
    ];
    warnings.push(`Normalized legacy validation fields into typed validation: ${usedLegacyFields.join(", ")}.`);

    return {
      validation: assertValidValidationContract({
        mode: "command",
        command: legacyCommand,
        coverageThreshold,
      }),
      usedLegacyFields,
      warnings,
    };
  }

  if (legacyNotes) {
    const usedLegacyFields = [
      "acceptanceSignal",
      ...(coverageThreshold !== undefined ? ["coverageThreshold"] : []),
    ];
    warnings.push(`Normalized legacy validation fields into typed validation: ${usedLegacyFields.join(", ")}.`);

    return {
      validation: assertValidValidationContract({
        mode: "manual",
        notes: legacyNotes,
        coverageThreshold,
      }),
      usedLegacyFields,
      warnings,
    };
  }

  throw new Error("Invalid validation contract: missing validation object and no legacy validation fields were provided");
}

export function normalizeGeneratedValidationContract(input: GeneratedValidationContractInput): NormalizedValidationContractResult {
  if (!input.validation) {
    throw new Error(`Invalid ${input.source} validation contract: generated artifacts must include validation.mode explicitly`);
  }

  const legacyFieldNames = [
    ...(input.testCommand ? ["test_command"] : []),
    ...(input.acceptanceSignal ? ["acceptance_signal"] : []),
    ...(input.coverageThreshold !== undefined ? ["coverage_threshold"] : []),
  ];

  if (legacyFieldNames.length > 0) {
    throw new Error(
      `Invalid ${input.source} validation contract: generated artifacts must not use legacy fields (${legacyFieldNames.join(", ")}); put all validation data in validation`,
    );
  }

  return {
    validation: assertValidValidationContract(input.validation),
    usedLegacyFields: [],
    warnings: [],
  };
}

export function materializeLegacyValidationFields(validation: TaskValidationContract): ValidationLegacyFields {
  const normalized = assertValidValidationContract(validation);
  if (normalized.mode === "manual") {
    return {};
  }

  return {
    acceptanceSignal: normalized.command,
    coverageThreshold: normalized.coverageThreshold,
  };
}

export function detectValidationFramework(command: string, output: string): string {
  const haystack = `${command}\n${output}`.toLowerCase();
  if (haystack.includes("pytest") || haystack.includes("coverage.py") || haystack.includes("pytest-cov")) return "pytest";
  if (haystack.includes("vitest")) return "vitest";
  if (haystack.includes("jest") || haystack.includes("istanbul") || haystack.includes("nyc")) return "jest";
  if (haystack.includes("go test") || /coverage:\s*\d+(?:\.\d+)?%\s+of\s+statements/i.test(output)) return "go";
  if (haystack.includes("cargo llvm-cov") || haystack.includes("llvm-cov")) return "cargo-llvm-cov";
  if (haystack.includes("tarpaulin")) return "tarpaulin";
  if (haystack.includes("cargo test")) return "cargo";
  return "generic";
}

function lastCoverageMatch(output: string, pattern: RegExp): number | undefined {
  const values = [...output.matchAll(pattern)]
    .map((match) => Number(match[1]))
    .filter((value) => !Number.isNaN(value));
  return values.length > 0 ? values[values.length - 1] : undefined;
}

function extractCoverageWithFramework(output: string, framework: string): number | undefined {
  switch (framework) {
    case "pytest":
      return (
        lastCoverageMatch(output, /TOTAL\s+\d+\s+\d+\s+(\d+(?:\.\d+)?)%/g) ??
        lastCoverageMatch(output, /coverage[^\n]*?(\d+(?:\.\d+)?)%/gi)
      );
    case "vitest":
    case "jest":
      return (
        lastCoverageMatch(output, /All files[^\n]*?\|[^\n]*?\|[^\n]*?\|[^\n]*?\|\s*(\d+(?:\.\d+)?)\s*\|/g) ??
        lastCoverageMatch(output, /Lines\s*:\s*(\d+(?:\.\d+)?)%/gi) ??
        lastCoverageMatch(output, /Statements\s*:\s*(\d+(?:\.\d+)?)%/gi) ??
        lastCoverageMatch(output, /All files[^\n]*?(\d+(?:\.\d+)?)\s*%/g)
      );
    case "go":
      return lastCoverageMatch(output, /coverage:\s*(\d+(?:\.\d+)?)%\s+of\s+statements/gi);
    case "cargo-llvm-cov":
      return (
        lastCoverageMatch(output, /total:\s*\(statements\)\s*(\d+(?:\.\d+)?)%/gi) ??
        lastCoverageMatch(output, /TOTAL(?:\s+COVERAGE)?[^\n]*?(\d+(?:\.\d+)?)%/gi)
      );
    case "tarpaulin":
      return (
        lastCoverageMatch(output, /coverage[^\n]*?(\d+(?:\.\d+)?)%/gi) ??
        lastCoverageMatch(output, /(\d+(?:\.\d+)?)%\s+coverage/gi)
      );
    default:
      return undefined;
  }
}

export function extractCoverage(output: string, framework: string): number | undefined {
  const frameworkSpecific = extractCoverageWithFramework(output, framework);
  if (frameworkSpecific !== undefined) return frameworkSpecific;

  const patterns: RegExp[] = [
    /Statements\s*:\s*(\d+(?:\.\d+)?)%/gi,
    /Lines\s*:\s*(\d+(?:\.\d+)?)%/gi,
    /Branches\s*:\s*(\d+(?:\.\d+)?)%/gi,
    /Functions\s*:\s*(\d+(?:\.\d+)?)%/gi,
    /coverage:\s*(\d+(?:\.\d+)?)%/gi,
    /TOTAL COVERAGE:\s*(\d+(?:\.\d+)?)%/gi,
    /overall\s+coverage[^\n]*?(\d+(?:\.\d+)?)%/gi,
    /total[^\n]*?coverage[^\n]*?(\d+(?:\.\d+)?)%/gi,
  ];

  for (const pattern of patterns) {
    const value = lastCoverageMatch(output, pattern);
    if (value !== undefined) return value;
  }

  const genericPercentages = [...output.matchAll(/(\d+(?:\.\d+)?)\s*%/g)]
    .map((match) => Number(match[1]))
    .filter((value) => !Number.isNaN(value) && value >= 0 && value <= 100);
  return genericPercentages.length > 0 ? genericPercentages[genericPercentages.length - 1] : undefined;
}

export async function runTaskValidation<TTask extends ValidationTaskLike>(
  task: TTask,
  hooks: ValidationHooks
): Promise<TaskValidationResult> {
  const normalizedContract = task.validation
    ? assertValidValidationContract(task.validation)
    : normalizeValidationContract({
        testCommand: task.testCommand,
        acceptanceSignal: task.acceptanceSignal,
        coverageThreshold: task.coverageThreshold,
      }).validation;

  task.validation = normalizedContract;
  task.coverageThreshold = normalizedContract.coverageThreshold;

  if (normalizedContract.mode === "manual") {
    task.validationOutput = "Manual validation mode: shell validation intentionally skipped.";
    task.validationFramework = undefined;
    task.lastCoverage = undefined;
    return { passed: true, output: task.validationOutput };
  }

  const command = normalizeValidationCommand(normalizedContract.command);
  if (!command) {
    throw new Error("Invalid validation contract: mode=command requires a non-empty validation.command");
  }

  assertSafeValidationCommand(command);

  const result = await hooks.exec(command);
  let output = [
    `$ ${command}`,
    `exit: ${result.code}`,
    result.stdout || "",
    result.stderr || "",
  ].filter(Boolean).join("\n");

  const framework = detectValidationFramework(command, output);
  const coverage = extractCoverage(output, framework);
  let passed = result.code === 0;
  output += `\n[task-forge] validation framework: ${framework}`;

  if (task.coverageThreshold !== undefined) {
    if (coverage === undefined) {
      passed = false;
      output += `\n[task-forge] coverage threshold ${task.coverageThreshold}% configured, but no coverage value could be parsed from validation output.`;
    } else if (coverage < task.coverageThreshold) {
      passed = false;
      output += `\n[task-forge] coverage ${coverage}% is below threshold ${task.coverageThreshold}%.`;
    }
  }

  task.validationOutput = output;
  task.validationFramework = framework;
  task.lastCoverage = coverage;
  return { passed, output, coverage };
}
