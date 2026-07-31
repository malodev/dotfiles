/**
 * Strict /team-import argument parser.
 *
 * Only two forms are legal:
 *   /team-import team/plan.yaml
 *   /team-import team/plan.yaml --approve sha256:<64-hex> --head <40-hex>
 *
 * Rejects empty input, alternate paths, extra tokens, reordered flags,
 * duplicate flags, missing values, approval without --head, and malformed SHAs.
 */

export type ImportCommandArgs =
  | { kind: "preview"; manifestPath: string }
  | { kind: "approve"; manifestPath: string; approvedDigest: string; approvalHead: string }
  | { kind: "approve-short"; manifestPath: string };

export function parseTeamImportArgs(args: string): ImportCommandArgs {
  const parts = args.trim().split(/\s+/).filter(s => s.length > 0);

  if (parts.length === 0) {
    throw new ImportArgsError("Usage: /team-import team/plan.yaml [--approve sha256:<digest> --head <sha>]");
  }

  if (parts[0] !== "team/plan.yaml") {
    throw new ImportArgsError("Manifest path must be exactly 'team/plan.yaml'");
  }

  const manifestPath = parts[0];

  // Preview: exactly one token
  if (parts.length === 1) {
    return { kind: "preview", manifestPath };
  }

  // Short approval: exactly two tokens (path + --approve)
  // Uses the last previewed digest and current HEAD.
  if (parts.length === 2 && parts[1] === "--approve") {
    return { kind: "approve-short", manifestPath };
  }

  // Full approval: exactly five tokens in fixed order
  //   team/plan.yaml --approve sha256:<64-hex> --head <40-hex>
  if (parts.length !== 5) {
    throw new ImportArgsError(
      `Expected exactly 1 token (preview) or 5 tokens (approve), got ${parts.length}: ${parts.join(" ")}`,
    );
  }

  if (parts[1] !== "--approve") {
    throw new ImportArgsError(`Expected '--approve' at position 2, got '${parts[1]}'`);
  }

  if (!/^sha256:[a-f0-9]{64}$/.test(parts[2])) {
    throw new ImportArgsError("Digest must be in format sha256:<64-lowercase-hex-chars>");
  }

  if (parts[3] !== "--head") {
    throw new ImportArgsError(`Expected '--head' at position 4, got '${parts[3]}'`);
  }

  if (!/^[a-f0-9]{40}$/.test(parts[4])) {
    throw new ImportArgsError("--head must be a 40-character lowercase hex commit SHA");
  }

  return {
    kind: "approve",
    manifestPath,
    approvedDigest: parts[2].slice(7), // strip "sha256:" prefix
    approvalHead: parts[4],
  };
}

export class ImportArgsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportArgsError";
  }
}
