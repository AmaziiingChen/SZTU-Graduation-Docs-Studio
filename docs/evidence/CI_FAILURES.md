# CI failure log

One line per failed run, with the category that decides what to fix: a mistake we
can prevent, or an environment fact we can only detect faster. Read together with
[BUILD_PLAYBOOK.md](../BUILD_PLAYBOOK.md).

| Run | Symptom | Category | Prevention added |
| --- | --- | --- | --- |
| CI 44126191069 (Windows) | `expected undefined to match object { state: 'downloaded' }` in the slow-download test | our mistake | fake timers must yield to real I/O: `await new Promise(r => realTimer(r, 2))` between advances |
| Package acceptance 44126191024 | same test failed inside `package:win:offline` | our mistake | packaging runs the full test suite, so a Windows-only test failure blocks packaging too |
| Chinese profile 44126640616 | same test again | our mistake | fixed at the source rather than per-workflow |
| Chinese profile 44128583611 | timed out in "prepare a workspace" | our mistake | `Copy-Item -Recurse` over 400 MB plus `icacls /T`; replaced with robocopy and an inherited ACL |
| Chinese profile 45201663709 | `xelatex ... timed out after 60 seconds` during packaging smoke test | our mistake | cold-start compile budget raised to 300 s with captured output |
| Chinese profile 45203821485 | `Batch logon privilege needs to be enabled for the task principal` | environment fact | grant `SeBatchLogonRight` via `secedit`, plus a six-minute early abort when no stage marker appears |
| Chinese profile 45217212843 | `Cannot find module 'app-builder-lib'` | our mistake | robocopy of `node_modules` preserves links to the original path; reinstall inside the copied workspace |
| Chinese profile 45220165882 | `Cannot find module 'electron-builder'` | environment fact | pnpm store lived under `runneradmin`; pass `--store-dir` inside the shared workspace |
| Chinese profile 45224027955 | `ENOENT ... Thesis\templates\proposal\fixtures\normal.json` | our mistake | exclude only `Thesis\.git`, not the whole template checkout |
| Chinese profile 45228708848 | `REQUIRED_FONT_MISSING` under the acceptance account | environment fact | a scheduled task inherits the machine environment; export `SZTU_FONT_DIR` explicitly |
| Chinese paths 45183974596 (Windows) | `RENDER_FAILED` after 2 s, no usable detail | our mistake | gate ran the template checkout's copy of `validate_cjk_render.py`; two copies must stay identical |
| Chinese paths 45183974596 (Windows) | `pdftotext version 4.06` usage dump | environment fact | the bundled Windows runtime ships Xpdf, which lacks `-bbox-layout`; the gate now falls back to a page-ink check and reads text from stdout |
| Package acceptance 45573860972 | `EBUSY: copyfile FZXiaoBiaoSong-B05S.ttf` | our mistake | the base and offline configs both copied the same font; `check_packaging_plan.mjs` now rejects duplicate destinations |
| CI 45183974696 | `preflight.ready` false on runners without Poppler | our mistake | tests must patch `shutil.which` when they assert export readiness |

## Recurrence rule

A category-"our mistake" entry that appears twice with the same shape means the
check was missing, not the fix. Add the check first, prove it fails on the
original mistake, then fix the code.
