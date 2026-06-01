import logging
from pathlib import Path

from src.sources import Source
from src.sources.apkpure import ApkPureSource
from src.sources.direct import DirectSource

log = logging.getLogger(__name__)

SOURCES: dict[str, type[Source]] = {
    "direct": DirectSource,
    "apkpure": ApkPureSource,
}


def get_source(source_type: str) -> Source:
    if source_type not in SOURCES:
        raise ValueError(f"Unknown source type: {source_type}. Available: {list(SOURCES.keys())}")
    return SOURCES[source_type]()


def download_apk(
    source_type: str,
    package_id: str,
    version: str,
    dest: Path,
    config: dict | None = None,
) -> Path:
    source = get_source(source_type)
    return source.download(package_id, version, dest, config)
