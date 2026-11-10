"""Package ONLY public, reviewed helper files. Never reads configuration or secrets."""
import argparse,hashlib,io,json,tarfile
from pathlib import Path

def build(output):
    source=Path(__file__).resolve().parent
    names=['bootstrap.py','manager.py','load-dadata-secret.cjs','policy.json','backup-preview.py']
    files={name:(source/name).read_bytes() for name in names}
    files['manifest.json']=(json.dumps({name:hashlib.sha256(value).hexdigest() for name,value in files.items()},indent=2)+'\n').encode()
    output.parent.mkdir(parents=True,exist_ok=True)
    with tarfile.open(output,'w:gz') as archive:
        for name,value in files.items():
            entry=tarfile.TarInfo(name);entry.size=len(value);entry.mode=0o600
            archive.addfile(entry,io.BytesIO(value))
    print(json.dumps({'archive':str(output.resolve()),'sha256':hashlib.sha256(output.read_bytes()).hexdigest(),'files':list(files)}))

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('output',type=Path)
    build(parser.parse_args().output)
