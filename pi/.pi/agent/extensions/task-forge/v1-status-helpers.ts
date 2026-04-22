/**
 * Sort V1 blockers so direct (non-dependency) blockers appear before
 * dependency blockers. Uses a lightweight heuristic: blockers whose
 * reason starts with "Blocked by failed dependency:" are placed last.
 * Stable sort — relative order within each group is preserved.
 */
export function v1BlockerSortOrder<T extends { reason: string }>(blockers: T[]): T[] {
  return [...blockers].sort((a, b) => {
    const aDep = a.reason.startsWith("Blocked by failed dependency:") ? 1 : 0;
    const bDep = b.reason.startsWith("Blocked by failed dependency:") ? 1 : 0;
    return aDep - bDep;
  });
}