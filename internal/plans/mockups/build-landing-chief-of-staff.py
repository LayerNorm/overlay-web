#!/usr/bin/env python3
"""Build landing-chief-of-staff.html: the "AI Chief of Staff" messaging proposal.

Inlines the production landing stylesheet, the approved brand SVGs and the Slack
logo into landing-chief-of-staff.src.html so the mockup opens from disk.

    python3 internal/plans/mockups/build-landing-chief-of-staff.py
"""
import base64
import json
import re
from pathlib import Path

HERE = Path(__file__).parent
ROOT = HERE.parents[2]
s = (HERE / "landing-chief-of-staff.src.html").read_text()
parts = {
    "/*LANDING_CSS*/": (ROOT / "src/features/marketing/landing/landing.css").read_text(),
    "<!--MARK-->": (HERE / "overlay-brand-approved/overlay-icon.svg").read_text().strip(),
    "<!--WORDMARK-->": (HERE / "overlay-brand-approved/overlay-wordmark.svg").read_text().strip(),
    "{{SLACK}}": "data:image/svg+xml;base64,"
    + base64.b64encode((ROOT / "public/assets/svg/landing/slack.svg").read_bytes()).decode(),
}

def icon(name: str) -> str:
    src = (ROOT / f"node_modules/lucide-react/dist/esm/icons/{name}.js").read_text()
    out = []
    for tag, attrs in re.findall(r'\[\s*"(\w+)",\s*\{([^}]*)\}\s*\]', src):
        pairs = [(k, v) for k, v in re.findall(r'(\w+):\s*"([^"]*)"', attrs) if k != "key"]
        out.append(f"<{tag} " + " ".join(f'{k}="{v}"' for k, v in pairs) + "/>")
    return "".join(out)


names = set(re.findall(r'data-lucide="([\w-]+)"', s)) | {
    n for n in re.findall(r"""['"]([a-z][a-z0-9-]+)['"]""", s)
    if (ROOT / f"node_modules/lucide-react/dist/esm/icons/{n}.js").exists()
}
parts["/*ICONS*/"] = json.dumps({n: icon(n) for n in sorted(names)})
s = re.sub(r"\{\{LOGO:([\w-]+)\}\}", lambda m: "data:image/svg+xml;base64,"
           + base64.b64encode((ROOT / f"public/assets/svg/landing/{m.group(1)}.svg").read_bytes()).decode(), s)
for key, value in parts.items():
    if key not in s:
        raise SystemExit(f"missing placeholder {key}")
    s = s.replace(key, value)
(HERE / "landing-chief-of-staff.html").write_text(s)
print("wrote landing-chief-of-staff.html")
