"""Fetch the exact published baseline and previously accepted candidate; no student data."""
import hashlib,json,os,shutil,subprocess,urllib.request
from pathlib import Path
from ci_resources import extract_zip
ROOT=Path(__file__).resolve().parents[1]
CONFIG=json.loads((ROOT/'config/windows-regression.json').read_text())
OUT=ROOT/'build/windows-regression-inputs'

def main():
    repo=CONFIG['repository']
    if not json.loads(subprocess.check_output(['gh','api',f'repos/{repo}']))['private']:
        raise RuntimeError('Private regression resources require a private repository')
    OUT.mkdir(parents=True,exist_ok=False)
    for label in ['baseline','candidate']:
        item=CONFIG[label]
        if 'url_env' in item:
            target=OUT/(label+'.exe')
            url=os.environ.get(item['url_env'])
            if not url:raise RuntimeError('Baseline download URL is not configured')
            with urllib.request.urlopen(url,timeout=60) as response,target.open('wb') as f:
                shutil.copyfileobj(response,f)
        elif 'asset_id' in item:
            target=OUT/(label+'.exe')
            with target.open('wb') as f:subprocess.run(['gh','api',f'repos/{repo}/releases/assets/{item["asset_id"]}','-H','Accept: application/octet-stream'],stdout=f,check=True)
        else:
            archive=OUT/(label+'.zip')
            with archive.open('wb') as f:subprocess.run(['gh','api',f'repos/{repo}/actions/artifacts/{item["artifact_id"]}/zip'],stdout=f,check=True)
            extracted=OUT/label;extract_zip(archive,extracted)
            matches=list(extracted.rglob('*-offline.exe'))
            if len(matches)!=1:raise RuntimeError('Candidate artifact must contain exactly one offline installer')
            target=OUT/(label+'.exe');matches[0].rename(target);archive.unlink()
        with target.open('rb') as f:sha=hashlib.file_digest(f,'sha256').hexdigest()
        if sha!=item['sha256'] or target.stat().st_size!=item['size_bytes']:
            raise RuntimeError(f'{label} installer integrity failed')
        print(label,'installer verified:',sha)

if __name__=='__main__':main()
