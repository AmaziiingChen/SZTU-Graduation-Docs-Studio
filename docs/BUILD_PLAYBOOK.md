# Build playbook

Read this before changing packaging configs, CI workflows, template resources, or
anything that only Windows can fail on. It exists because the same class of
mistake kept costing a full 25-minute acceptance run to discover.

## 1. The feedback loop is the problem, not the fix

A Windows acceptance run is roughly 25 minutes: package, install, exercise seven
documents, upload evidence. If one run tells us one mistake, ten small mistakes
cost four hours. So the rule is:

> Spend local minutes to remove whole classes of failure before spending CI
> half-hours to find them one by one.

## 2. Before every push

Run these from the repository root. All of them are cheap.

| Command | Catches |
| --- | --- |
| `node scripts/check_packaging_plan.mjs` | duplicate extraResources targets (the EBUSY class), version drift, template-pin drift, missing document fonts |
| `python3 scripts/run_backend_tests.py` | backend behaviour, including packaging guards under `scripts/test_*.py` |
| `cd apps/desktop && npx tsc -p tsconfig.electron.json --noEmit` | Electron main-process types |
| `npx tsc -b` (root) | renderer types |
| `npx vitest run` (root) | component and integration behaviour |
| `pnpm lint` | style gate, kept at zero errors |
| `python3 templates/thesis/test.py` (template checkout) | thesis layout and bibliography geometry |

`pnpm verify` chains most of the above; use it before a release commit.

## 3. Packaging configuration rules

1. **One owner per destination file.** `electron-builder.offline.yml` extends
   `electron-builder.yml`; entries in both write into the same staging tree. Two
   entries copying the same file to the same place race on Windows and fail with
   `EBUSY: resource busy or locked`. `check_packaging_plan.mjs` enforces this.
2. **Read the extended config before adding an entry.** The base file already
   ships `FZXiaoBiaoSong-B05S.ttf`; the offline config must not repeat it.
3. **Resolve `from:` like electron-builder does.** It is relative to
   `apps/desktop`, so `../../local-fonts` means the repository root.
4. **Assets are staged, then checked, then packaged.** `stage_thesis_template.py`
   and `stage_document_fonts.py` run before `check_packaging_plan.mjs` inside
   `scripts/package_windows.mjs`; that ordering is deliberate.
5. **Anything gitignored must be reproducible.** `local-fonts/` is ignored, so
   the staging script has to be able to find every font it needs.

## 4. Windows differences worth memorising

| Area | What bites |
| --- | --- |
| File locks | Copying the same target twice, or copying a file still mapped by another process, fails with `EBUSY` / `EPERM`. |
| Permissions | CI builds as `runneradmin`; the acceptance account is a standard user. Anything created under a profile directory is unreadable to it. pnpm's store in `C:\Users\runneradmin` is the classic case. |
| Scheduled tasks | A freshly created standard account has no `SeBatchLogonRight`; `schtasks /create` succeeds but the task never starts. |
| pnpm links | Copying `node_modules` with robocopy preserves links to the original absolute path; always reinstall instead. |
| Paths | 260-character limit in the Win32 API; poppler's `openFile()` silently truncates at `MAX_PATH`. Keep output paths short and ASCII. |
| Encoding | Console output is code page 936. Decode with UTF-8 then GB18030, never assume UTF-8. |
| Poppler build | The bundled Windows runtime ships Xpdf 4.06, not poppler: `pdftotext -bbox-layout` does not exist, and writing to non-ASCII paths fails. |
| Cold start | The first `xelatex` run formats fonts and takes minutes; a 60-second timeout is a bug, not a flake. |

## 5. Versioning

- The version lives in `package.json` and `apps/desktop/package.json`; keep them
  equal (`check_packaging_plan.mjs` verifies it).
- Update manifests may carry a subset of platforms. A client that finds no
  artifact for its platform reports `up_to_date` instead of failing, so a Windows
  release does not force a macOS rebuild.
- Publish from a green acceptance run and record the exact artifact hash.

## 6. Hard rules

1. Same failure twice means stop and add a check, not another fix.
2. Never use a release as the first test of a packaging change.
3. Never let CI be the first reader of a config file.
4. When a check is added, make it fail loudly on the mistake it targets, and
   prove it by reintroducing the mistake once.
