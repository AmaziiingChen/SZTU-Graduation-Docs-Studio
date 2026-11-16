"""Record provenance and hashes, without uploading private CI source assets."""
import hashlib
import json
import os
from pathlib import Path

root = Path(__file__).resolve().parents[1]
out = root / 'tmp/ci-acceptance'
out.mkdir(parents=True, exist_ok=True)
artifacts = []
for pattern in ('release/*.dmg', 'release/*.zip', 'release/offline/*-offline.exe'):
    for p in root.glob(pattern):
        with p.open('rb') as f:
            checksum = hashlib.file_digest(f, 'sha256').hexdigest()
        artifacts.append({'path': p.relative_to(root).as_posix(), 'size_bytes': p.stat().st_size, 'sha256': checksum})
report = {'commit': os.environ.get('GITHUB_SHA'), 'platform': os.environ.get('RUNNER_OS'),
          'run': os.environ.get('GITHUB_RUN_ID'), 'artifacts': artifacts, 'published': False}
(out / 'artifacts.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
summary = os.environ.get('GITHUB_STEP_SUMMARY')
if summary:
    with Path(summary).open('a', encoding='utf-8') as f:
        f.write('## Internal package acceptance\n\n')
        f.write(f'Commit: `{report["commit"]}`. Installers are internal artifacts; no public update was changed.\n\n')
        acceptance = out / 'acceptance.json'
        if acceptance.exists():
            result = json.loads(acceptance.read_text(encoding='utf-8'))
            f.write(f'Installed engine: **{result.get("status", "incomplete")}**. ')
            f.write(f'Documents: {len(result["documents"])} / 7. Diagnostics: {len(result["diagnostics"])}.\n\n')
        else:
            f.write('Installed-engine acceptance did not complete. Inspect the failed step.\n\n')
        for a in artifacts:
            f.write(f'- `{a["path"]}`: {a["size_bytes"]} bytes; SHA-256 `{a["sha256"]}`\n')
