import os
import shutil
from pathlib import Path

import httpx

TOOLS_DIR = Path(os.environ.get("RELEVANCE_TOOLS_DIR", ".tools"))

JAR_REPOS: dict[str, tuple[str, str]] = {
    "APKEditor": ("REAndroid/APKEditor", "APKEditor"),
    "uber-apk-signer": ("patrickfav/uber-apk-signer", "uber-apk-signer"),
    "apktool": ("iBotPeaches/Apktool", "apktool"),
    "morphe-desktop": ("MorpheApp/morphe-desktop", "morphe-desktop"),
}


def get_tool(name: str) -> Path:
    system = shutil.which(name)
    if system:
        return Path(system)

    tool_path = TOOLS_DIR / name
    if tool_path.exists():
        return tool_path

    jar_path = TOOLS_DIR / f"{name}.jar"
    if jar_path.exists():
        return jar_path

    if name == "apkeep":
        return _download_apkeep()

    raise FileNotFoundError(
        f"Tool '{name}' not found in PATH or {TOOLS_DIR}. "
        f"Set RELEVANCE_TOOLS_DIR or install the tool."
    )


def get_jar(name: str) -> Path:
    TOOLS_DIR.mkdir(parents=True, exist_ok=True)
    jar_path = TOOLS_DIR / f"{name}.jar"
    if jar_path.exists() and jar_path.stat().st_size > 50_000:
        return jar_path

    if name in JAR_REPOS:
        repo, prefix = JAR_REPOS[name]
        return _download_github_jar(repo, prefix, jar_path)

    raise FileNotFoundError(
        f"JAR '{name}' not found at {jar_path}. "
        f"Set RELEVANCE_TOOLS_DIR or download the tool."
    )


def _download_github_jar(repo: str, prefix: str, dest: Path) -> Path:
    headers = {"Accept": "application/vnd.github+json", "User-Agent": "relevance-pipeline"}
    token = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"

    resp = httpx.get(
        f"https://api.github.com/repos/{repo}/releases/latest",
        headers=headers,
        timeout=30,
        follow_redirects=True,
    )
    resp.raise_for_status()
    release = resp.json()

    for asset in release.get("assets", []):
        aname = asset.get("name", "")
        if aname.startswith(prefix) and aname.endswith(".jar") and not aname.endswith(".asc"):
            url = asset["browser_download_url"]
            with httpx.stream("GET", url, headers=headers, follow_redirects=True, timeout=180) as r:
                r.raise_for_status()
                with open(dest, "wb") as f:
                    for chunk in r.iter_bytes(65536):
                        f.write(chunk)
            return dest

    raise RuntimeError(f"Could not find {prefix}*.jar in {repo} latest release")


def _download_apkeep() -> Path:
    TOOLS_DIR.mkdir(parents=True, exist_ok=True)
    dest = TOOLS_DIR / "apkeep"
    url = "https://github.com/EFForg/apkeep/releases/latest/download/apkeep-x86_64-unknown-linux-gnu"
    with httpx.stream("GET", url, follow_redirects=True, timeout=120) as r:
        r.raise_for_status()
        with open(dest, "wb") as f:
            for chunk in r.iter_bytes(65536):
                f.write(chunk)
    dest.chmod(0o755)
    return dest
