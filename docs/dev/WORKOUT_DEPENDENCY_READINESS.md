# Workout visual slice: dependency readiness

Verified locally on 2026-10-22 in the isolated `codex/workout-visual-slice` worktree, based on strength commit `f1aabdb74903ba4ed37fbe26d12ef17ed9532155`. The original strength and main checkouts were not changed.

## Installer disposition

Node **22.17.0**, matching the repository's Node 22 line, was used throughout. A clean `npm ci` of the original frontend lock succeeded. Updating Vite/Vitest with npm **10.9.2** reproduced `Cannot read properties of null (reading 'edgesOut')` in Arborist's peer-set construction. The log shows exploration of optional Vitest/browser and Vite devtools peer packages immediately before the crash; it did not change the tracked manifests or locks.

Using the already-installed npm **11.19.1** executable under the same Node 22 runtime completed the targeted update. This fixes this task's installation workflow; it is not a claim that npm 10's mutation bug has been repaired. No global installation, `--force`, `--legacy-peer-deps`, or dependency override was used. Subsequent clean `npm ci` runs with the normal npm 10.9.2 succeeded from both resulting frontend and MCP lockfiles, so ordinary locked builds do not require a toolchain migration.

## Changes

- Frontend Vite **8.1.5 → 8.1.6**; MCP's existing transitive Vite **8.2.2 → 8.2.4**. Both stay on their prior minor lines. The MCP resolver initially selected a newer minor; the final lock retains 8.2.4 and the baseline compatible Rolldown/PostCSS support versions instead.
- Both packages' Vitest and coverage lower bounds move to **4.1.12**; the lock updates the matching Vitest family, including `@vitest/mocker`, and compatible test-only helper dependencies.
- Remove unused frontend devDependency **`@capacitor/assets` 3.0.5**. This native icon/splash generator has no invocation in the tracked build/test scripts or documentation; this fork has removed its native shells and serves existing PWA assets. Its latest registry release still pins old Sharp and pulls Capacitor CLI 5 / tar / Xcode / UUID tooling. Removing it eliminates that unused chain (126 installed packages), including the critical tar finding, without incompatible transitive overrides. Other Capacitor dependencies and runtime gating remain unchanged. Anyone reintroducing native asset generation must choose and review its tooling separately.
- API dependency files and all application runtime dependencies remain unchanged.

## Advisory evidence

Fresh npm audits of the complete lockfiles, including development and optional dependencies:

| Package | Before | After |
| --- | --- | --- |
| Frontend | 11: 1 critical, 4 high, 6 moderate | **0** |
| MCP | 4: 1 high, 3 moderate | **0** |
| API | Prior acceptance reported 0 | **0**, freshly checked |

The [Vite advisory](https://github.com/advisories/GHSA-rq7h-c2jc-7f22) names 8.1.6 and 8.2.4 as patched releases. The [Vitest mocker advisory](https://github.com/advisories/GHSA-qxg6-89mg-rqv8) names 4.1.12. Registry metadata confirms compatibility with Node 22.17. The old critical finding was in native asset tooling; its presence alone did not establish a served-PWA exploit. Zero audit findings are a point-in-time registry result, not a general security certification.

## Checks completed at this checkpoint

- Original locked installs: frontend, API (`--omit=optional`), MCP passed.
- Patched clean installs: frontend and MCP passed under npm 10.9.2 / Node 22.17.0.
- `npm ls --depth=0`: frontend and MCP passed with no invalid dependency report.
- MCP: **95 tests / 3 files passed**, plus the complete plain-Node import graph.
- All three fresh audits: **zero vulnerabilities**.
- `git diff --check`: passed for the dependency changes.

Frontend functional tests, production build, and the rest of the visual slice's validation are recorded in the slice acceptance report; this checkpoint does not substitute for those checks. Raw audit JSON and a captured excerpt of the reproduced npm crash (the original npm cache log was later pruned) are retained in the local task's `output/dependencies/` directory, outside Git.
