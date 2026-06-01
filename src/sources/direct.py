from pathlib import Path

import httpx
from rich.progress import Progress

from src.sources import Source


class DirectSource(Source):
    def download(
        self,
        package_id: str,
        version: str,
        dest: Path,
        config: dict | None = None,
    ) -> Path:
        if config is None or "url" not in config:
            raise ValueError("Direct source requires a 'url' in config")

        url = config["url"]
        dest.mkdir(parents=True, exist_ok=True)

        filename = url.split("/")[-1].split("?")[0]
        if not filename.endswith(".apk"):
            filename = f"{package_id}.apk"
        file_path = dest / filename

        with Progress() as progress:
            task = progress.add_task(f"Downloading {package_id}...", total=None)
            with httpx.stream("GET", url, follow_redirects=True, timeout=60) as response:
                response.raise_for_status()
                total = int(response.headers.get("content-length", 0))
                progress.update(task, total=total)

                with open(file_path, "wb") as f:
                    for chunk in response.iter_bytes(8192):
                        f.write(chunk)
                        progress.advance(task, len(chunk))

        return file_path
