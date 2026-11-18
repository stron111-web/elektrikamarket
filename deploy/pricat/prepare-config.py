#!/usr/bin/env python3
"""Prepare a separate v2 config. Never overwrite or install a live file."""
import argparse
import json
import os
from pathlib import Path
import stat


def prepare(current):
    # Retain endpoint, secret file references, target DB and technical limits.
    if current['ftp']['customerCode'] != '891661':
        raise ValueError('CUSTOMER_IDENTITY_REQUIRES_REVIEW')
    result = json.loads(json.dumps(current))
    result['sourcePolicyVersion'] = 'owner-current-source-v2'
    result['sourceIdentity'] = {'senderGln': '4607166859990'}
    result['runtimeLimits'] = {'maxRunMs': 5400000, 'stallMs': 900000, 'terminateGraceMs': 15000}
    for key in ['maxSourceDropFraction', 'maxMatchedDropFraction', 'maxIssueFraction',
                'maxMissingFraction', 'maxRemovedFraction', 'maxChangedPriceFraction',
                'maxStockCellLossFraction', 'maxPriceChangeFactor', 'maxQuantityChangeFactor']:
        result['policy'].pop(key, None)
    result['policy']['minSourceRecords'] = 1
    return result


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser()
    parser.add_argument('--input', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    source, destination = Path(args.input), Path(args.output)
    fd = os.open(source, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd) as f:
        info = os.fstat(f.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
            raise ValueError('PRIVATE_INPUT_REQUIRED')
        candidate = prepare(json.load(f))
    parent = destination.parent.lstat()
    if not stat.S_ISDIR(parent.st_mode) or parent.st_uid != os.getuid() or parent.st_mode & 0o077:
        raise ValueError('PRIVATE_OUTPUT_DIRECTORY_REQUIRED')
    fd = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w') as f:
        json.dump(candidate, f, indent=2)
        f.write('\n');f.flush();os.fsync(f.fileno())
    print('CANDIDATE_CONFIG_CREATED_0600; no live file changed')


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('CANDIDATE_CONFIG_NOT_CREATED')
        raise SystemExit(1)
