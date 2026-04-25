# Task Graph

1. **T1 (S)** Runtime freeze and V1 authority audit  
2. **T2 (M)** Define command result contract and scaffold V2 command services *(depends: T1)*  
3. **T3 (M)** Implement `v2/transition-policy.ts` with unit coverage *(depends: T2)*  
4. **T4 (M)** Refactor `index.ts` into thin delegation shell *(depends: T2, T3)*  
5. **T5 (M)** Flip `/forge status` to V2-only snapshot path *(depends: T3, T4)*  
6. **T6 (L)** Flip `/forge execute` and `/forge resume` to V2-only policy path *(depends: T3, T4)*  
7. **T7 (L)** Flip `/forge blocker` variants to V2-only event-backed behavior *(depends: T3, T4, T6)*  
8. **T8 (M)** Flip remaining commands (`pause/abort/cost/models/config/help`) to V2 services *(depends: T4, T3)*  
9. **T9 (M)** Implement explicit one-way legacy migration module and guardrails *(depends: T4)*  
10. **T10 (M)** Remove/quarantine V1 runtime command authority *(depends: T5, T6, T7, T8, T9)*  
11. **T11 (M)** Harden validation command policy and evidence summarization *(depends: T6, T7)*  
12. **T12 (L, iterative)** Add replay and regression suites for end-to-end determinism *(depends: T5, T6, T7, T8, T9, T10, T11)*  
13. **T13 (M)** Update docs + add drift checks (`EVENTS.md`, README, runbook, history markers) *(depends: T10, T11, T12)*