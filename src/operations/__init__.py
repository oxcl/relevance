from abc import ABC, abstractmethod
from pathlib import Path

from src.config import Operation


class OperationBase(ABC):
    @abstractmethod
    def apply(self, apk_path: Path, op_config: Operation, work_dir: Path) -> Path:
        """Apply operation to APK, return path to output APK."""
        ...
