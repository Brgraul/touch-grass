"""Check review coverage and source freshness; architectural judgments remain manual."""

import argparse
import hashlib
from pathlib import Path
import re
import sys


def check_review(skills_root: Path, repo_root: Path) -> list[str]:
    skills = sorted(skills_root.glob("principle-*/SKILL.md"))
    if not skills:
        return [f"No principle skills found under {skills_root}"]

    report = (repo_root / "ARCHITECTURE-REVIEW.md").read_text()
    rows = re.findall(
        r"^\| `(principle-[^`]+)` \| (Aligned|Gap|Conditional|Unproven) \|",
        report,
        re.MULTILINE,
    )
    expected = {skill.parent.name for skill in skills}
    actual = {name for name, _ in rows}
    errors = []
    if expected - actual:
        errors.append(f"Missing assessments: {sorted(expected - actual)}")
    if actual - expected:
        errors.append(f"Unknown assessments: {sorted(actual - expected)}")
    duplicates = sorted(name for name in actual if sum(row[0] == name for row in rows) > 1)
    if duplicates:
        errors.append(f"Duplicate assessments: {duplicates}")

    principles_hash = hashlib.sha256()
    for skill in skills:
        principles_hash.update(skill.parent.name.encode() + b"\0" + skill.read_bytes() + b"\0")
    digests = {
        "architecture": hashlib.sha256((repo_root / "ARCHITECTURE.md").read_bytes()).hexdigest(),
        "principles": principles_hash.hexdigest(),
    }
    for source, digest in digests.items():
        if f"<!-- {source}-sha256: {digest} -->" not in report:
            errors.append(f"Review is stale: {source} fingerprint differs; current SHA-256 is {digest}")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--skills-root",
        type=Path,
        default=Path("/Users/pc/.codex/plugins/cache/pstack-claude/pstack/0.9.90/skills"),
    )
    args = parser.parse_args()
    repo_root = Path(__file__).resolve().parents[1]
    errors = check_review(args.skills_root, repo_root)
    if errors:
        for error in errors:
            print(error, file=sys.stderr)
        return 1
    count = len(list(args.skills_root.glob("principle-*/SKILL.md")))
    print(f"PASS: {count}/{count} principle assessments; architecture and skill fingerprints match.")
    print("Coverage and freshness only; semantic conclusions require manual review.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
