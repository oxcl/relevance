import logging
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
        config: dict | None = None,
    ) -> Path:
        dest.mkdir(parents=True, exist_ok=True)

        apk_path = self._try_apkeep(package_id, version, dest)
        if apk_path and apk_path.exists():
            return apk_path

        log.warning("apkeep failed for %s, falling back to justapk", package_id)
        apk_path = self._try_justapk(package_id, version, dest)
        if apk_path and apk_path.exists():
            return apk_path

        raise RuntimeError(
            f"Failed to download {package_id} from APKPure (both apkeep and justapk failed)"
        )

    def _try_apkeep(self, package_id: str, version: str, dest: Path) -> Path | None:
        try:
            apkeep = get_tool("apkeep")
        except FileNotFoundError:
            log.warning("apkeep not found, skipping")
            return None

        spec = f"{package_id}@{version}" if version and version != "latest" else package_id
        cmd = [str(apkeep), "-a", spec, str(dest)]

        import subprocess

        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
            if result.returncode != 0:
                log.warning("apkeep failed: %s", result.stderr)
                return None
        except Exception as e:
            log.warning("apkeep execution failed: %s", e)
            return None

        return self._find_apk(dest, package_id)

    def _try_justapk(self, package_id: str, version: str, dest: Path) -> Path | None:
        import subprocess

        cmd = [
            "python3", "-m", "justapk", "download",
            package_id,
            "-o", str(dest),
        ]
        if version and version != "latest" and version != "auto":
            cmd.extend(["-v", version])

        result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
        if result.returncode != 0:
            log.warning("justapk failed: %s", result.stderr)
            return None

        return self._find_apk(dest, package_id)

    def _find_apk(self, dest: Path, package_id: str) -> Path | None:
        apk_files = list(dest.glob("*.apk"))
        if apk_files:
            return apk_files[0]

        xapk_files = list(dest.glob("*.xapk"))
        if xapk_files:
            return xapk_files[0]

        apks_files = list(dest.glob("*.apks"))
        if apks_files:
            return apks_files[0]

        return None
