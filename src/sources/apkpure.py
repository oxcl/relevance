import logging
import subprocess
from pathlib import Path

from src.sources import Source
from src.tools import get_tool

log = logging.getLogger(__name__)


class ApkPureSource(Source):
    def download(
        self,
        package_id: str,
        version: str,
        dest: Path,
        config: dict[str, str] | None = None,
    ) -> Path:
        dest.mkdir(parents=True, exist_ok=True)

        existing = self._find_apk(dest, package_id, version)
        if existing and existing.exists() and existing.stat().st_size > 1_000_000:
            return existing

        apk_path = self._try_apkeep(package_id, version, dest)
        if apk_path and apk_path.exists():
            return apk_path

        log.warning("apkeep failed for %s@%s, falling back to justapk", package_id, version)
        apk_path = self._try_justapk(package_id, version, dest)
        if apk_path and apk_path.exists():
            return apk_path

        raise RuntimeError(
            f"Failed to download {package_id}@{version} from APKPure "
            "(both apkeep and justapk failed)"
        )

    def _try_apkeep(self, package_id: str, version: str, dest: Path) -> Path | None:
        try:
            apkeep = get_tool("apkeep")
        except FileNotFoundError:
            log.warning("apkeep not found, skipping")
            return None

        spec = (
            f"{package_id}@{version}"
            if version and version not in ("latest", "auto")
            else package_id
        )
        commands = [
            [
                str(apkeep),
                "-a",
                spec,
                "-d",
                "apk-pure",
                "-o",
                "acknowledge_dangers=true",
                str(dest),
            ],
            [str(apkeep), "-a", spec, "-d", "apk-pure", str(dest)],
        ]

        for cmd in commands:
            try:
                result = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
                found = self._find_apk(dest, package_id, version)
                if result.returncode == 0 and found and found.exists():
                    return found
                log.warning("apkeep attempt returned %s: %s", result.returncode, result.stderr)
            except Exception as e:
                log.warning("apkeep execution failed: %s", e)

        return self._find_apk(dest, package_id, version)

    def _try_justapk(self, package_id: str, version: str, dest: Path) -> Path | None:
        cmd = [
            "python3",
            "-m",
            "justapk",
            "download",
            package_id,
            "-o",
            str(dest),
        ]
        if version and version not in ("latest", "auto"):
            cmd.extend(["-v", version])

        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
            if result.returncode != 0:
                log.warning("justapk failed: %s", result.stderr)
                return None
        except Exception as e:
            log.warning("justapk execution failed: %s", e)
            return None

        return self._find_apk(dest, package_id, version)

    def _find_apk(self, dest: Path, package_id: str, version: str = "") -> Path | None:
        for ext in ("*.apk", "*.xapk", "*.apkm", "*.apks"):
            candidates = sorted(
                [p for p in dest.glob(ext) if not p.name.endswith("-merged.apk")],
                key=lambda p: p.stat().st_mtime,
                reverse=True,
            )
            if version and version not in ("latest", "auto"):
                matching = [p for p in candidates if version in p.name]
                if matching:
                    return matching[0]
            if candidates:
                return candidates[0]
        return None
