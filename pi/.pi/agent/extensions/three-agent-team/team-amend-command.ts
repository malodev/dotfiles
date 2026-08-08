import { isSha1, isSha256 } from "./core.ts";

/**
 * Strict /team-amend argument parser.
 *
 * Only two forms are legal:
 *   /team-amend team/amendment.yaml
 *   /team-amend team/amendment.yaml --approve sha256:<64-hex> --head <40-hex>
 *
 * Mirrors /team-import: preview has no side effects and prints the exact
 * approval command; approval is bound to the previewed digest and the exact
 * HEAD, so an owner can never approve something other than what they saw.
 */

export const AMENDMENT_MANIFEST_PATH = "team/amendment.yaml";

export type AmendCommandArgs =
  | { kind: "preview"; manifestPath: string }
  | { kind: "approve"; manifestPath: string; approvedDigest: string; approvalHead: string };

export function parseTeamAmendArgs(args: string): AmendCommandArgs {
  const parts = args.trim().split(/\s+/).filter((token) => token.length > 0);

  if (parts.length === 0) {
    throw new AmendArgsError(`Usage: /team-amend ${AMENDMENT_MANIFEST_PATH} [--approve sha256:<digest> --head <sha>]`);
  }

  if (parts[0] !== AMENDMENT_MANIFEST_PATH) {
    throw new AmendArgsError(`Manifest path must be exactly '${AMENDMENT_MANIFEST_PATH}'`);
  }

  const manifestPath = parts[0];

  if (parts.length === 1) {
    return { kind: "preview", manifestPath };
  }

  if (parts.length !== 5) {
    throw new AmendArgsError(
      `Expected exactly 1 token (preview) or 5 tokens (approve), got ${parts.length}: ${parts.join(" ")}`,
    );
  }

  if (parts[1] !== "--approve") {
    throw new AmendArgsError(`Expected '--approve' at position 2, got '${parts[1]}'`);
  }

  if (!parts[2].startsWith("sha256:") || !isSha256(parts[2].slice("sha256:".length))) {
    throw new AmendArgsError("Digest must be in format sha256:<64-lowercase-hex-chars>");
  }

  if (parts[3] !== "--head") {
    throw new AmendArgsError(`Expected '--head' at position 4, got '${parts[3]}'`);
  }

  if (!isSha1(parts[4])) {
    throw new AmendArgsError("--head must be a 40-character lowercase hex commit SHA");
  }

  return {
    kind: "approve",
    manifestPath,
    approvedDigest: parts[2].slice("sha256:".length),
    approvalHead: parts[4],
  };
}

export class AmendArgsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AmendArgsError";
  }
}
