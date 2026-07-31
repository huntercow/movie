#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

python3 - <<'PY'
import re
import subprocess
import sys

paths = subprocess.check_output(
    ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"]
).split(b"\0")

patterns = [
    re.compile(r"-----BEGIN (?:RSA|EC|OPENSSH|DSA|PGP) PRIVATE KEY-----"),
    re.compile(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b"),
    re.compile(r"\bLTAI[A-Za-z0-9]{12,}\b"),
    re.compile(
        r"(?i)(?:password|secret|api[_-]?key|access[_-]?key|cookie|authorization)"
        r"\s*[\"']?\s*[:=]\s*[\"']?([A-Za-z0-9+/=_-]{24,})"
    ),
    re.compile(r"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b"),
]
safe_placeholder = re.compile(r"(?i)(?:placeholder|example|change[-_]?me|replace[-_]?me)")

findings = []
for raw_path in paths:
    if not raw_path:
        continue
    path = raw_path.decode("utf-8", errors="strict")
    try:
        content = open(path, "rb").read()
    except OSError:
        continue
    if b"\0" in content[:8192]:
        continue
    text = content.decode("utf-8", errors="replace")
    found_secret = False
    for pattern in patterns:
        for match in pattern.finditer(text):
            candidate = match.group(1) if pattern.groups else match.group(0)
            if not safe_placeholder.search(candidate):
                found_secret = True
                break
        if found_secret:
            break
    if found_secret:
        findings.append(path)

if findings:
    print("Potential secret patterns detected; file contents are intentionally omitted:")
    for path in sorted(set(findings)):
        print(f"- {path}")
    sys.exit(1)

print("Secret scan passed; no high-confidence secret pattern found.")
PY
