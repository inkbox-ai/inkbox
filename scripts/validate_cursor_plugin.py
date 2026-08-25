#!/usr/bin/env python3
"""Validate the static Cursor Plugin package in the Inkbox monorepo."""

from __future__ import annotations

import json
import re
from collections.abc import Iterable
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MANIFEST_PATH = ROOT / ".cursor-plugin" / "plugin.json"
MCP_PATH = ROOT / ".cursor-mcp.json"
SKILLS_PATH = ROOT / "cursor-skills"
README_PATH = ROOT / "CURSOR_PLUGIN.md"
CHANGELOG_PATH = ROOT / "CURSOR_PLUGIN_CHANGELOG.md"
EXPECTED_SKILLS = {
    "inkbox-a2a",
    "inkbox-call-review",
    "inkbox-contact-management",
    "inkbox-contact-rules",
    "inkbox-email-triage",
    "inkbox-identity-profile",
    "inkbox-imessage-responder",
    "inkbox-mcp",
    "inkbox-notes-memory",
    "inkbox-outbound-calling",
    "inkbox-send-email",
    "inkbox-sms-responder",
}


def require(condition: object, message: str) -> None:
    if not condition:
        raise ValueError(message)


def load_json(path: Path) -> dict[str, object]:
    value = json.loads(path.read_text())
    require(isinstance(value, dict), f"{path.relative_to(ROOT)} must be an object")
    return value


def resolve_manifest_path(value: object) -> Path:
    require(
        isinstance(value, str) and value.startswith("./"),
        "manifest component paths must be relative to the plugin root",
    )
    resolved = (ROOT / value).resolve()
    require(resolved.is_relative_to(ROOT), "manifest path escapes the plugin root")
    require(resolved.exists(), f"missing manifest component: {value}")
    return resolved


def parse_frontmatter(path: Path) -> dict[str, str]:
    lines = path.read_text().splitlines()
    require(lines and lines[0] == "---", f"{path.relative_to(ROOT)} lacks frontmatter")
    try:
        end = lines.index("---", 1)
    except ValueError as exc:
        raise ValueError(f"{path.relative_to(ROOT)} has unclosed frontmatter") from exc

    fields: dict[str, str] = {}
    for line in lines[1:end]:
        key, separator, value = line.partition(":")
        require(
            separator and key and value.strip(),
            f"invalid frontmatter line in {path.relative_to(ROOT)}: {line!r}",
        )
        fields[key] = value.strip()
    require(
        set(fields) == {"name", "description"},
        f"{path.relative_to(ROOT)} frontmatter must contain only name and description",
    )
    return fields


def validate_markdown_links(paths: Iterable[Path]) -> None:
    link_pattern = re.compile(r"\[[^]]+\]\(([^)]+)\)")
    for path in paths:
        for target in link_pattern.findall(path.read_text()):
            if target.startswith(("https://", "http://", "mailto:", "#")):
                continue
            local_target = target.split("#", 1)[0]
            require(
                (path.parent / local_target).exists(),
                f"broken local link in {path.relative_to(ROOT)}: {target}",
            )


def main() -> None:
    manifest = load_json(MANIFEST_PATH)
    require(manifest["name"] == "inkbox", "plugin name must be inkbox")
    require(
        re.fullmatch(r"\d+\.\d+\.\d+", str(manifest["version"])),
        "plugin version must use semantic versioning",
    )
    require(manifest["license"] == "MIT", "plugin license must be MIT")
    require(
        manifest["repository"] == "https://github.com/inkbox-ai/inkbox",
        "plugin repository URL is incorrect",
    )
    require(
        manifest["homepage"] == "https://inkbox.ai/docs/integrations/cursor-plugin",
        "plugin homepage must point to the Cursor documentation",
    )

    logo_path = resolve_manifest_path(manifest["logo"])
    skills_path = resolve_manifest_path(manifest["skills"])
    mcp_path = resolve_manifest_path(manifest["mcpServers"])
    require(logo_path.suffix == ".svg", "plugin logo must be an SVG")
    require(
        skills_path == SKILLS_PATH and skills_path.is_dir(),
        "manifest must reference cursor-skills",
    )
    require(mcp_path == MCP_PATH, "manifest must reference .cursor-mcp.json")

    mcp = load_json(MCP_PATH)
    require(
        mcp
        == {
            "mcpServers": {
                "inkbox": {
                    "type": "http",
                    "url": "https://inkbox.ai/mcp/cursor",
                }
            }
        },
        ".cursor-mcp.json must contain only the hosted Inkbox Cursor server",
    )
    mcp_text = MCP_PATH.read_text()
    require("${" not in mcp_text, ".cursor-mcp.json must not contain variables")
    require(
        "api_key" not in mcp_text.lower(), ".cursor-mcp.json must not contain API keys"
    )
    require(
        "authorization" not in mcp_text.lower(),
        ".cursor-mcp.json must not contain authorization headers",
    )

    skill_dirs = {path.name for path in skills_path.iterdir() if path.is_dir()}
    require(
        skill_dirs == EXPECTED_SKILLS,
        "Cursor skill directory set does not match validation",
    )
    for skill_name in sorted(skill_dirs):
        skill_file = skills_path / skill_name / "SKILL.md"
        require(skill_file.is_file(), f"missing {skill_file.relative_to(ROOT)}")
        frontmatter = parse_frontmatter(skill_file)
        require(
            frontmatter["name"] == skill_name,
            f"{skill_file.relative_to(ROOT)} name must match its directory",
        )
        require(
            len(frontmatter["description"]) >= 80,
            f"{skill_file.relative_to(ROOT)} description is too short",
        )

    require(README_PATH.is_file(), "CURSOR_PLUGIN.md is required")
    require(
        f"## {manifest['version']} " in CHANGELOG_PATH.read_text(),
        "Cursor plugin changelog must contain the manifest version",
    )
    validate_markdown_links([README_PATH, CHANGELOG_PATH, *skills_path.rglob("*.md")])
    print(
        f"Validated Cursor Plugin {manifest['version']} with {len(skill_dirs)} skills"
    )


if __name__ == "__main__":
    main()
