# Personal strength acceptance

Verified locally on 2026-10-22 at implementation commit `90707cac` (documentation updates follow). Source review and an installed iPhone on the user's supported HTTPS origin remain release gates. Local browser success does not establish iPhone readiness or authorize deployment or importing personal history.

## Automated verification

Host suites used Node 22.17.0 and ran sequentially. Docker 29.1.3 ran Linux/arm64 images built from the repository; the current `node:22-alpine` base reported Node 22.23.4. No paid service or AI request was used.

| Command | Result |
| --- | --- |
| `cd frontend && npm test` | 411 files, 5,251 tests passed |
| `cd frontend && npm run build` | Passed; existing chunk-size and ineffective dynamic-import warnings remain |
| `cd frontend && node scripts/check-locales.mjs` | 18 locales, 2,438 keys each, in sync |
| `cd frontend && node scripts/check-source-strings.mjs` | 1,914 source strings present in locale packs |
| `cd frontend && npm run test:fatigue-probe` | 108,000 monotonic comparisons and 1,800 history-edit comparisons passed |
| `cd api && npm test` | 601 passed; existing MockTimers experimental warning |
| `cd mcp && npm test` | 95 passed |
| `cd mcp && npm run check:node-loadable` | Complete plain-Node MCP import graph passed |
| `node scripts/build-coach-assets.mjs --check` | Generated catalogue (5,632 exercises) and six prompts in sync |
| `node api/scripts/check-core-loadable.mjs` | Plain-Node API coach/core graph passed |
| `.github/workflows/test.yml` API image checks | Default, coach and untargeted images built; all three additionally booted and answered `/api/config`. Default and untargeted omit the Agent SDK, Codex and bubblewrap. Coach SDK check, Codex version, bubblewrap version, and `coach 700` ownership/mode on `/coach-auth` passed. Default `id coach` passed. |
| Production web Docker image | Built and served the PWA through nginx and the real API |

Image checks used unique disposable names and loopback ports, with no personal host profile, `.env`, real data or provider credentials mounted. These are local Linux/arm64 checks, not a new hosted CI run or an amd64-platform check.

## Authenticated production-PWA scenario

Chrome used an isolated 390 × 844 mobile/touch context and a separate isolated sign-in context. A temporary self-signed localhost TLS proxy served the production web image and real API. Certificate exceptions were confined to these browser contexts; this is not the user's supported HTTPS origin. Signup occurred through **Create new profile → Password** with a disposable synthetic account. `/api/me` returned 200; config confirmed guest mode disabled, password login enabled, and coach disabled.

Setup seeded only invented PPL routines, exact local stations and one comparable prior session through the authenticated data API. Setup is distinct from the UI behavior below. Early fixture mismatches correctly produced “No comparable history”; correcting the synthetic snapshot's mode and station identity made it comparable. No application fix or test suppression was needed.

| Behavior exercised | Observed result |
| --- | --- |
| Next PPL session and history | Synthetic Push started from Home. Comparable 14 October history showed `40×8, 40×8 (RIR 2)` and the selected linear policy explained the editable 42.5 kg prescription. |
| Occupied-station replacement | Temporarily excluded the occupied incline station, selected a same-role dumbbell press and chose **Keep this workout only**. The original routine remained unchanged. The replacement's unspecified station/load basis remained unknown. |
| Set logging and effort | Entered three 20 kg rows; final working-set RIR 2 was stored only on the last row. Earlier ratings stayed absent. Actual final reps were edited to 9 while the prescription remained 10. |
| Cached shell and reopening | Service worker ready, non-null controller, and stamped `opengym-rt-*` cache observed before disconnecting. Offline reload recovered the active workout, completed rows and RIR. `/api/` requests failed offline rather than being served from a data cache. |
| Offline completion and reconnect | Finished and saved offline, reloaded offline, then reconnected. The real server held exactly one new workout ID, no active workout, and final ratings `[unknown, unknown, 2]`. |
| Coverage and repeat reads | Rolling coverage showed chest 3 completed sets and triceps/shoulders 1.5 estimated sets each. Reload, retry and backup restoration retained one completion and the same coverage. |
| Explicit missed day and adaptation | Marked 22 October missed. Five total sessions and a 75-minute budget credited the completed Push, then previewed Pull/Legs/Upper/Lower on 23–26 October (estimated 4/4/10/4 minutes for these deliberately small fixtures). The preview disclosed remaining direct-day gaps. Acceptance preserved completed records, original PPL routines and reusable rotation, with provenance on future sessions. |
| Committed write with lost response | A scoped browser route let the real acceptance PUT commit (200), then dropped its response. Pending local changes remained visible. **Try again** succeeded with unchanged workout and queue IDs; no duplicate completion or coverage appeared. |
| Historical import twice | Selected an invented Markdown note through Settings, reviewed and imported it. The second preview showed **New: 0**, one duplicate source skipped, and disabled Import. The accepted queue did not advance. |
| Backup and restore | Exported the synthetic JSON backup through Settings, imported it through the replacement confirmation, then reloaded. Three unique workouts, accepted queue IDs and final-set-only RIR survived on the API. This exercised restoration of the same backup, not recovery after storage eviction or server loss. |
| Independent server persistence | A second isolated browser signed in with the disposable password and independently loaded the same three workout IDs, queue IDs and `[unknown, unknown, 2]` ratings from the server. |
| Touch, focus and scrolling | Emulated touchscreen tap opened chest coverage details; input focus and scroll-to-field worked. Mobile and 1280 × 900 desktop screenshots were inspected; no horizontal overflow in those observed views. Real iOS keyboard behavior was not established. |

Browser/API evidence, screenshots, console/network logs and synthetic backups remain in ignored local task artifacts. Expected errors were initial unauthenticated `/api/me` (401), deliberately offline requests, and the deliberately dropped committed response. The first web probe returned a transient 502 before nginx finished starting; subsequent authenticated checks used the running API. No guest-only result is counted as acceptance.

## Remaining gates and limitations

- **Installed iPhone:** paired devices were unavailable/disconnected at the final access check, and no supported user HTTPS origin was supplied. Verify actual installation, iOS keyboard visibility, screen lock/reopen, airplane-mode logging, reconnection, single completion and backup/restore on that origin before claiming daily-device readiness. Desktop touch emulation does not satisfy this gate.
- **Dependencies:** existing audits report frontend 11 advisories (1 critical, 4 high, 6 moderate), MCP 4 (1 high, 3 moderate), API 0. Official advisories identify compatible patches [Vite 8.1.6](https://github.com/advisories/GHSA-rq7h-c2jc-7f22) and [Vitest/mocker 4.1.12](https://github.com/advisories/GHSA-qxg6-89mg-rqv8); registry metadata confirms Node 22 compatibility and matching coverage 4.1.12. npm 10.9.2 and installed npm 11.3.0 both crashed in Arborist peer resolution (`Cannot read properties of null (reading 'edgesOut')`) before changing tracked files. No patched-dependency claim is made. Resolve installation and rerun checks before treating these advisories as closed. Native asset tooling also retains the `@capacitor/assets` → image/project tooling chain, including sharp/tar/xcode/uuid findings; no forced override or broad Capacitor migration was attempted. The critical finding is in tooling, not proof of a served-PWA exploit; network-exposed development servers remain outside this harness.
- **Research and copy:** [policy v1](PERSONAL_STRENGTH_POLICY.md) distinguishes observed work, planning preferences and uncertain scientific heuristics. New locale keys use the milestone's English fallback convention; locale completeness is not translation review. [Fitbod findings](FITBOD_RESEARCH.md) are static artifact evidence plus welcome-screen observation; live gym inventory, account flows and proprietary ranking/progression remain unverified. No subscription was purchased or proprietary dataset copied.
- **Rollout:** review, deployment and previewed personal-history import remain separate operations. This local record does not certify storage eviction recovery, real-device background behavior, all browser engines, or production TLS configuration.
