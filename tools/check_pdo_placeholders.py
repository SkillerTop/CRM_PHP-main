from __future__ import annotations

import collections
import pathlib
import re


ROOT = pathlib.Path(__file__).resolve().parents[1]
PREPARE = re.compile(r"->prepare\(\s*(['\"])(.*?)\1\s*\)", re.DOTALL)
PLACEHOLDER = re.compile(r"(?<!:):([A-Za-z_][A-Za-z0-9_]*)")


def main() -> int:
    problems = 0
    for path in sorted((ROOT / "src").rglob("*.php")):
        text = path.read_text(encoding="utf-8")
        for match in PREPARE.finditer(text):
            names = PLACEHOLDER.findall(match.group(2))
            duplicates = [name for name, count in collections.Counter(names).items() if count > 1]
            if not duplicates:
                continue
            line = text.count("\n", 0, match.start()) + 1
            print(f"{path.relative_to(ROOT)}:{line}: duplicate placeholders: {', '.join(duplicates)}")
            problems += 1
    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main())
