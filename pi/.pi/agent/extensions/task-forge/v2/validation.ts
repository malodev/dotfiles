import type { TaskValidationResult } from "./task-success";

export interface ValidationExecResult {
  code: number;
  stdout?: string;
  stderr?: string;
}

export interface ValidationTaskLike {
  testCommand?: string;
  acceptanceSignal?: string;
  coverageThreshold?: number;
  validationOutput?: string;
  validationFramework?: string;
  lastCoverage?: number;
}

export interface ValidationHooks {
  exec: (command: string) => Promise<ValidationExecResult>;
}

export function normalizeValidationCommand(command?: string): string | undefined {
  if (!command) return undefined;
  let normalized = command.trim();
  normalized = normalized.replace(/\s+exits?\s+0\s*$/i, "");
  normalized = normalized.replace(/\s+returns?\s+0\s*$/i, "");
  normalized = normalized.replace(/^command:\s*/i, "");
  return normalized.trim() || undefined;
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
  const command = normalizeValidationCommand(task.testCommand || task.acceptanceSignal);
  if (!command) {
    task.validationOutput = "No validation command configured.";
    task.validationFramework = undefined;
    task.lastCoverage = undefined;
    return { passed: true, output: task.validationOutput };
  }

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
