# TaskForge Roadmap

## Next

- [ ] Auto-clear `pendingHumanIntervention` when blocker patch/retry makes task runnable.  
  *We hit this repeatedly during real forge runs — blockers require manual resolution even after patching.*

- [ ] Lifecycle integration test: fail → patch → retry → resume → execute.  
  *This exact flow broke multiple times. Needs test coverage.*

## Done (recent)

- V1 code deleted, V2-only event-sourced runtime
- Planning extracted to `src/commands/plan.ts`
- Bare `tsc --noEmit` stripped at normalization
- `scripts/drift-check.sh` — 6 automated checks
- Agent prompts cleaned (no bare tsc instructions)
- 320 tests, snapshot migration, transition policy
