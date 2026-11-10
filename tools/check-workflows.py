#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
# Global Intelligence Atlas: lint the GitHub Actions workflows for the mistakes that most often let someone take a
# repository over (security.yml runs it on every push).
#   1. Every action from another repository is pinned to a full 40-character commit SHA. A tag such as @v4 can be
#      moved by whoever controls that repository; a commit cannot.
#   2. Every workflow states its token permissions at the top, so none silently gets the broad default.
#   3. No `run:` script pastes event or input text in with ${{ ... }}. That text is typed by other people (an issue
#      title, a branch name, a form field), and pasted into a shell it can run commands. Pass it in through `env:`.
#   4. No pull_request_target trigger, which runs a stranger's pull request with this repository's secrets.
# Usage: python3 tools/check-workflows.py .github/workflows     (exit code 1 when something is wrong)
import os, re, sys

UNTRUSTED = re.compile(r'\$\{\{[^}]*(github\.event\.|inputs\.|github\.head_ref|env\.)[^}]*\}\}')
SHA = re.compile(r'@[0-9a-f]{40}(\s|$)')


def check(path):
    text = open(path, encoding='utf-8').read()
    lines = text.split('\n')
    problems = []
    if not re.search(r'^permissions:', text, re.M):
        problems.append('no top-level "permissions:" block')
    if re.search(r'^\s*pull_request_target\s*:', text, re.M):
        problems.append('uses pull_request_target')
    in_run, run_indent = False, 0
    for n, line in enumerate(lines, 1):
        stripped = line.strip()
        m = re.match(r'^(\s*)(?:- )?uses:\s*(\S+)', line)
        if m and not m.group(2).startswith('./') and not m.group(2).startswith('docker://') and not SHA.search(line):
            problems.append(f'line {n}: {m.group(2)} is not pinned to a commit SHA')
        r = re.match(r'^(\s*)(?:- )?run:\s*(.*)$', line)
        if r:
            in_run, run_indent = True, len(r.group(1))
            if UNTRUSTED.search(r.group(2)):
                problems.append(f'line {n}: event or input text pasted into a shell command; pass it through env:')
            if r.group(2) not in ('|', '>', '|-', '>-'):
                in_run = False
            continue
        if in_run:
            indent = len(line) - len(line.lstrip())
            if stripped and indent <= run_indent:
                in_run = False
            elif UNTRUSTED.search(line):
                problems.append(f'line {n}: event or input text pasted into a shell command; pass it through env:')
    return problems


def main(folder):
    bad = 0
    files = sorted(f for f in os.listdir(folder) if f.endswith(('.yml', '.yaml')))
    for f in files:
        p = check(os.path.join(folder, f))
        if p:
            bad += 1
            print(f'- **{f}**: ' + '; '.join(p))
    print(f'\nWorkflow check: {len(files) - bad} of {len(files)} workflows clean.')
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else '.github/workflows'))
