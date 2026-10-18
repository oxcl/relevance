from abc import ABC, abstractmethod
from pathlib import Path


class Source(ABC):
    @abstractmethod
    def download(
        self,
        package_id: str,
        version: str,
        dest: Path,
        config: dict[str, str] | None = None,
    ) -> Path:
        ...
