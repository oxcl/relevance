from abc import ABC, abstractmethod
from pathlib import Path


class Source(ABC):
    @abstractmethod
    def download(
        self,
        package_id: str,
        version: str,
        dest: Path,
        config: dict | None = None,
    ) -> Path:
        """Download APK and return the path to the downloaded file."""
        ...
