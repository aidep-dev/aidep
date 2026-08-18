#!/usr/bin/env python3
"""Block a commit that changes a transform without touching a test.

Transforms rewrite customer code; an untested change ships a corrupted repo.
Exit 2 blocks the tool call and returns stderr to Claude.
"""
import json
import subprocess
import sys

try:
    payload = json.load(sys.stdin)
    cmd = payload.get("tool_input", {}).get("command") or ""
    cwd = payload.get("cwd") or "."
except (json.JSONDecodeError, TypeError, AttributeError):
    sys.exit(0)  # malformed payload: never block on it

if not isinstance(cmd, str) or "git commit" not in cmd:
    sys.exit(0)

try:
    staged = subprocess.run(
        ["git", "diff", "--cached", "--name-only"],
        cwd=cwd, capture_output=True, text=True, timeout=10,
    ).stdout.split()
except (OSError, subprocess.SubprocessError):
    sys.exit(0)  # not a repo, no git: not our call to block

# ponytail: prefix match, not a glob. src/transforms/ holds only .ts today.
transforms = [p for p in staged if p.startswith("src/transforms/") and p.endswith(".ts")]
if transforms and not any(p.startswith("test/") for p in staged):
    print(
        f"Blocked: {', '.join(transforms)} staged with no test/ change. "
        "Add a fixture pair (input + expected) under test/fixtures/transforms/<case>/ "
        "and register the case in test/transforms.test.ts.",
        file=sys.stderr,
    )
    sys.exit(2)
