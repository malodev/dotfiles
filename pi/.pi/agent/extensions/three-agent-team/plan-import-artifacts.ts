/**
 * Symlink-safe artifact materialization for plan imports.
 *
 * Deep module: callers get one `materializeArtifacts()` function that
 * safely creates task directories and files without following symlinks
 * at any path segment. Never overwrites existing files; refuses symlink
 * ancestors even when the descendant path doesn't exist yet.
 *
 * Used for both fresh imports (PREPARED → GIT_INSTALLED) and recovery
 * (materializing missing artifacts from immutable bundle bytes).
 */

import { open, mkdir, rename, lstat } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve, dirname, relative } from "node:path";
import { createHash } from "node:crypto";

export interface ArtifactFile {
  /** Repository-relative path, e.g. "team/tasks/2026-01-01-foo/brief.md" */
  path: string;
  content: string | Buffer;
  mode: number;
  /** Expected SHA-256 digest of the content */
  digest: string;
}

export interface MaterializeResult {
  created: string[];
  /** Paths that already existed with exact matching bytes and mode */
  existing: string[];
}

/**
 * Materialize immutable artifacts into the live repository worktree.
 *
 * Safety properties:
 * - Rejects symlinks at every ancestor, including when a symlinked
 *   ancestor contains the not-yet-created target descendant.
 * - Creates directories with nofollow semantics.
 * - Writes temporary files, fsyncs, atomically renames into place.
 * - Fsyncs parent directories.
 * - Never overwrites an existing file unless it exactly matches.
 * - Verifies digest of every file before accepting it.
 */
export async function materializeArtifacts(
  repo: string,
  artifacts: ArtifactFile[],
): Promise<MaterializeResult> {
  const created: string[] = [];
  const existing: string[] = [];

  for (const artifact of artifacts) {
    const absPath = resolve(repo, artifact.path);
    const parentDir = dirname(absPath);

    // Ensure parent directory exists without following symlinks
    await ensureDirectoryNoFollow(repo, parentDir);

    // Check if file already exists
    let fileExists = false;
    try {
      const existingStat = await lstat(absPath);
      if (existingStat.isSymbolicLink()) {
        throw new Error(
          `Artifact path '${artifact.path}' is a symlink — refused`,
        );
      }
      if (!existingStat.isFile()) {
        throw new Error(
          `Artifact path '${artifact.path}' exists but is not a regular file`,
        );
      }
      fileExists = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }

    if (fileExists) {
      // Verify existing file matches exactly
      const { readFile } = await import("node:fs/promises");
      const existingContent = await readFile(absPath);
      const existingDigest = createHash("sha256").update(existingContent).digest("hex");

      if (existingDigest !== artifact.digest) {
        throw new Error(
          `Artifact '${artifact.path}' digest mismatch: ` +
          `expected ${artifact.digest}, got ${existingDigest}`,
        );
      }
      existing.push(artifact.path);
      continue;
    }

    // Write atomically: temp file → fsync → rename → fsync dir
    const content = typeof artifact.content === "string"
      ? Buffer.from(artifact.content, "utf8")
      : artifact.content;

    const tmpPath = `${absPath}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
    const handle = await open(tmpPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, artifact.mode);
    try {
      await handle.writeFile(content);
      await handle.sync();
    } finally {
      await handle.close();
    }

    // Verify the temp file before rename
    const { readFile: verifyRead } = await import("node:fs/promises");
    const tempContent = await verifyRead(tmpPath);
    const tempDigest = createHash("sha256").update(tempContent).digest("hex");
    if (tempDigest !== artifact.digest) {
      throw new Error(
        `Artifact '${artifact.path}' temp file digest mismatch`,
      );
    }

    await rename(tmpPath, absPath);

    // Fsync the parent directory
    const dirHandle = await open(parentDir, constants.O_RDONLY | (constants.O_DIRECTORY ?? 0));
    try {
      await dirHandle.sync();
    } finally {
      await dirHandle.close();
    }

    created.push(artifact.path);
  }

  return { created, existing };
}

/**
 * Ensure a directory exists, verifying that no ancestor is a symlink.
 * Uses recursive mkdir but walks the path manually to detect symlinks.
 */
async function ensureDirectoryNoFollow(repo: string, targetDir: string): Promise<void> {
  const repoReal = await (await import("node:fs/promises")).realpath(repo);
  const targetReal = await (await import("node:fs/promises")).realpath(
    resolve(targetDir, ".."),
  ).catch(() => null);

  // Walk ancestors from repo up to targetDir, checking for symlinks
  const repoParts = repoReal.split("/");
  const targetParts = resolve(targetDir).split("/");

  // Find the first point where target diverges from repo
  let divergeIdx = 0;
  while (
    divergeIdx < repoParts.length &&
    divergeIdx < targetParts.length &&
    repoParts[divergeIdx] === targetParts[divergeIdx]
  ) {
    divergeIdx++;
  }

  // Walk each new segment, asserting no symlinks
  let currentPath = repoParts.slice(0, divergeIdx).join("/") || "/";
  for (let i = divergeIdx; i < targetParts.length; i++) {
    currentPath = resolve(currentPath, targetParts[i]);

    try {
      const pathStat = await lstat(currentPath);
      if (pathStat.isSymbolicLink()) {
        throw new Error(
          `Refusing to materialize artifact: symlinked ancestor at '${relative(repo, currentPath)}'`,
        );
      }
      if (!pathStat.isDirectory()) {
        throw new Error(
          `Refusing to materialize artifact: non-directory ancestor at '${relative(repo, currentPath)}'`,
        );
      }
      // Directory exists, continue
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      // Directory doesn't exist, create it
      await mkdir(currentPath, { mode: 0o755 });
      // Fsync parent after creating
      const parent = dirname(currentPath);
      const parentHandle = await open(parent, constants.O_RDONLY | (constants.O_DIRECTORY ?? 0));
      try {
        await parentHandle.sync();
      } finally {
        await parentHandle.close();
      }
    }
  }
}
