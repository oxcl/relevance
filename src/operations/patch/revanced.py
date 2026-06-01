import logging
import re
import subprocess
from pathlib import Path

from src.config import Operation, PatchSourceEntry
from src.operations import OperationBase
from src.tools import get_jar

log = logging.getLogger(__name__)

CACHE_DIR = Path(".cache/revanced")


def download_patches(sources: list[PatchSourceEntry]) -> list[Path]:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    patches_paths = []

    for source in sources:
        if source.type == "github_release" and source.repo:
            rvp_path = _download_from_github(source)
            if rvp_path:
                patches_paths.append(rvp_path)

    return patches_paths


def _download_from_github(source: PatchSourceEntry) -> Path | None:
    import httpx

    api_url = f"https://api.github.com/repos/{source.repo}/releases/latest"
    try:
        resp = httpx.get(api_url, timeout=30, follow_redirects=True)
        resp.raise_for_status()
        release = resp.json()
    except Exception as e:
        log.warning("Failed to get latest release for %s: %s", source.repo, e)
        return None

    for asset in release.get("assets", []):
        name = asset["name"]
        if name.endswith(".rvp"):
            download_url = asset["browser_download_url"]
            dest = CACHE_DIR / name
            if dest.exists():
                return dest

            try:
                with httpx.stream("GET", download_url, follow_redirects=True, timeout=60) as r:
                    r.raise_for_status()
                    with open(dest, "wb") as f:
                        for chunk in r.iter_bytes(8192):
                            f.write(chunk)
                return dest
            except Exception as e:
                log.warning("Failed to download %s: %s", name, e)
                return None

    log.warning("No .rvp asset found in %s releases", source.repo)
    return None


def get_recommended_version(patches_paths: list[Path], package_id: str) -> str | None:
    revanced_cli = _get_revanced_cli()

    cmd = [
        "java", "-jar", str(revanced_cli),
        "list-versions",
        "-f", package_id,
    ]
    for p in patches_paths:
        cmd.extend(["-p", str(p)])

    result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    if result.returncode != 0:
        log.warning("list-versions failed: %s", result.stderr)
        return None

    best_version = None
    best_count = 0

    for line in result.stdout.splitlines():
        match = re.match(r"\s+(\d[\d.]+)\s+\((\d+)\s+patches?\)", line)
        if match:
            version = match.group(1)
            count = int(match.group(2))
            if count > best_count:
                best_version = version
                best_count = count

    return best_version


def apply_patches(
    apk_path: Path,
    op_config: Operation,
    patches_paths: list[Path],
    output_dir: Path,
) -> Path:
    revanced_cli = _get_revanced_cli()

    output_path = output_dir / f"{apk_path.stem}-patched.apk"

    cmd = [
        "java", "-jar", str(revanced_cli),
        "patch",
        "-o", str(output_path),
        "--purge",
    ]

    for p in patches_paths:
        cmd.extend(["-p", str(p)])

    include = op_config.patches.include
    exclude = op_config.patches.exclude

    if include:
        cmd.append("--exclusive")
        for patch_name in include:
            cmd.extend(["-e", patch_name])

    for patch_name in exclude:
        cmd.extend(["-d", patch_name])

    if op_config.force:
        cmd.append("-f")

    cmd.append(str(apk_path))

    result = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
    if result.returncode != 0:
        log.warning("revanced-cli patch failed: %s", result.stderr)
        raise RuntimeError(f"ReVanced patching failed: {result.stderr[:200]}")

    if not output_path.exists():
        raise RuntimeError("ReVanced patching produced no output file")

    return output_path


def list_patches(patches_paths: list[Path]) -> list[dict]:
    revanced_cli = _get_revanced_cli()

    cmd = [
        "java", "-jar", str(revanced_cli),
        "list-patches",
        "--packages",
        "--versions",
        "--options",
    ]
    for p in patches_paths:
        cmd.extend(["-p", str(p)])

    result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    if result.returncode != 0:
        log.warning("list-patches failed: %s", result.stderr)
        return []

    patches = []
    current_patch = {}

    for line in result.stdout.splitlines():
        line = line.strip()
        if line.startswith("Patch:"):
            if current_patch:
                patches.append(current_patch)
            current_patch = {"name": line[len("Patch:"):].strip()}
        elif line.startswith("Description:"):
            current_patch["description"] = line[len("Description:"):].strip()
        elif line.startswith("Compatible packages:"):
            current_patch["packages"] = []
        elif line.startswith("Default:"):
            current_patch["default"] = line[len("Default:"):].strip().lower() == "true"
        elif line.startswith("- "):
            if "packages" in current_patch:
                pkg_match = re.match(r"- (.+): (.+)", line)
                if pkg_match:
                    current_patch["packages"].append({
                        "name": pkg_match.group(1),
                        "versions": pkg_match.group(2).split(", "),
                    })

    if current_patch:
        patches.append(current_patch)

    return patches


def _get_revanced_cli() -> Path:
    try:
        return get_jar("revanced-cli")
    except FileNotFoundError:
        pass

    cli_path = CACHE_DIR / "revanced-cli.jar"
    if cli_path.exists():
        return cli_path

    CACHE_DIR.mkdir(parents=True, exist_ok=True)

    import httpx

    api_url = "https://api.github.com/repos/ReVanced/revanced-cli/releases/latest"
    try:
        resp = httpx.get(api_url, timeout=30, follow_redirects=True)
        resp.raise_for_status()
        release = resp.json()
    except Exception as e:
        raise RuntimeError(f"Failed to get revanced-cli release: {e}")

    for asset in release.get("assets", []):
        if asset["name"].endswith(".jar"):
            download_url = asset["browser_download_url"]
            try:
                with httpx.stream("GET", download_url, follow_redirects=True, timeout=60) as r:
                    r.raise_for_status()
                    with open(cli_path, "wb") as f:
                        for chunk in r.iter_bytes(8192):
                            f.write(chunk)
                return cli_path
            except Exception as e:
                raise RuntimeError(f"Failed to download revanced-cli: {e}")

    raise RuntimeError("No .jar asset found in revanced-cli releases")


class RevancedPatchOperation(OperationBase):
    def __init__(self, patches_paths: list[Path]):
        self.patches_paths = patches_paths

    def apply(self, apk_path: Path, op_config: Operation, work_dir: Path) -> Path:
        work_dir.mkdir(parents=True, exist_ok=True)
        return apply_patches(apk_path, op_config, self.patches_paths, work_dir)
