import logging
import re
import shutil
from pathlib import Path

from src.config import Operation
from src.operations import OperationBase
from src.tools import get_jar
from src.utils import run_cmd

log = logging.getLogger(__name__)


class CloneOperation(OperationBase):
    def apply(self, apk_path: Path, op_config: Operation, work_dir: Path) -> Path:
        new_package = op_config.new_package
        new_name = op_config.new_name
        if not new_package:
            raise ValueError("Clone operation requires 'new_package'")

        work_dir.mkdir(parents=True, exist_ok=True)

        decompiled = self._decompile(apk_path, work_dir)

        original_package = self._get_original_package(decompiled)
        original_name = self._get_original_name(decompiled, original_package)

        self._rename_package(decompiled, original_package, new_package)

        if new_name:
            self._rename_app(
                decompiled, original_name or original_package, new_name, original_package
            )

        output_apk = self._recompile(decompiled, work_dir, apk_path.stem)

        signed_apk = self._sign(output_apk)

        return signed_apk

    def _decompile(self, apk_path: Path, work_dir: Path) -> Path:
        apktool = get_jar("apktool")
        output = work_dir / "decompiled"

        if output.exists():
            shutil.rmtree(output)

        cmd = ["java", "-jar", str(apktool), "d", str(apk_path), "-o", str(output), "-f"]
        result = run_cmd(cmd, check=False)
        if result.returncode != 0:
            raise RuntimeError(f"apktool decompile failed: {result.stderr}")

        return output

    def _get_original_package(self, decompiled: Path) -> str:
        manifest = decompiled / "AndroidManifest.xml"
        content = manifest.read_text()
        match = re.search(r'package="([^"]+)"', content)
        if not match:
            raise RuntimeError("Could not find package name in AndroidManifest.xml")
        return match.group(1)

    def _get_original_name(self, decompiled: Path, package: str) -> str | None:
        manifest = decompiled / "AndroidManifest.xml"
        content = manifest.read_text()
        match = re.search(r'android:label="([^"]+)"', content)
        if not match:
            return None

        label = match.group(1)
        if label.startswith("@string/"):
            string_name = label[len("@string/"):]
            strings_xml = decompiled / "res" / "values" / "strings.xml"
            if strings_xml.exists():
                strings_content = strings_xml.read_text()
                string_match = re.search(
                    rf'<string name="{re.escape(string_name)}">([^<]+)</string>',
                    strings_content,
                )
                if string_match:
                    return string_match.group(1)
            return None
        return label

    def _rename_package(self, decompiled: Path, old_package: str, new_package: str) -> None:
        manifest = decompiled / "AndroidManifest.xml"
        content = manifest.read_text()
        content = content.replace(f'package="{old_package}"', f'package="{new_package}"')

        old_authorities = old_package + ".provider"
        new_authorities = new_package + ".provider"
        content = content.replace(old_authorities, new_authorities)

        manifest.write_text(content)

        yml = decompiled / "apktool.yml"
        if yml.exists():
            yml_content = yml.read_text()
            if "renameManifestPackage:" in yml_content:
                yml_content = re.sub(
                    r"renameManifestPackage:.*",
                    f"renameManifestPackage: {new_package}",
                    yml_content,
                )
            else:
                yml_content = yml_content.replace(
                    "doNotCompress:",
                    f"renameManifestPackage: {new_package}\ndoNotCompress:",
                )
            yml.write_text(yml_content)

        old_slash = old_package.replace(".", "/")
        new_slash = new_package.replace(".", "/")

        for smali_dir in decompiled.glob("smali*"):
            old_path = smali_dir / old_slash
            if old_path.exists():
                new_path = smali_dir / new_slash
                new_path.parent.mkdir(parents=True, exist_ok=True)

                if str(new_path).startswith(str(old_path) + "/"):
                    temp_path = smali_dir / (old_slash + "_temp")
                    if temp_path.exists():
                        shutil.rmtree(temp_path)
                    old_path.rename(temp_path)
                    new_path.parent.mkdir(parents=True, exist_ok=True)
                    temp_path.rename(new_path)
                else:
                    old_path.rename(new_path)

            for smali_file in smali_dir.rglob("*.smali"):
                try:
                    content = smali_file.read_text(encoding="utf-8", errors="ignore")
                    if old_slash in content:
                        content = content.replace(f"L{old_slash}/", f"L{new_slash}/")
                        smali_file.write_text(content, encoding="utf-8")
                except Exception:
                    pass

        for xml_file in decompiled.rglob("*.xml"):
            if xml_file == manifest:
                continue
            try:
                content = xml_file.read_text(encoding="utf-8", errors="ignore")
                if old_package in content:
                    content = content.replace(old_package, new_package)
                    xml_file.write_text(content, encoding="utf-8")
            except Exception:
                pass

    def _rename_app(
        self,
        decompiled: Path,
        old_name: str,
        new_name: str,
        package: str,
    ) -> None:
        manifest = decompiled / "AndroidManifest.xml"
        content = manifest.read_text()

        match = re.search(r'android:label="([^"]+)"', content)
        if not match:
            return

        label = match.group(1)
        if label.startswith("@string/"):
            string_name = label[len("@string/"):]
            strings_xml = decompiled / "res" / "values" / "strings.xml"
            if strings_xml.exists():
                strings_content = strings_xml.read_text()
                strings_content = re.sub(
                    rf'(<string name="{re.escape(string_name)}">)[^<]*(</string>)',
                    rf"\g<1>{new_name}\2",
                    strings_content,
                )
                strings_xml.write_text(strings_content)

            for values_dir in decompiled.glob("res/values-*"):
                localized_strings = values_dir / "strings.xml"
                if localized_strings.exists():
                    loc_content = localized_strings.read_text()
                    loc_content = re.sub(
                        rf'(<string name="{re.escape(string_name)}">)[^<]*(</string>)',
                        rf"\g<1>{new_name}\2",
                        loc_content,
                    )
                    localized_strings.write_text(loc_content)
        else:
            content = content.replace(
                f'android:label="{label}"',
                f'android:label="{new_name}"',
            )
            manifest.write_text(content)

    def _recompile(self, decompiled: Path, work_dir: Path, stem: str) -> Path:
        apktool = get_jar("apktool")
        output = work_dir / f"{stem}-unsigned.apk"

        cmd = ["java", "-jar", str(apktool), "b", str(decompiled), "-o", str(output)]
        result = run_cmd(cmd, check=False)
        if result.returncode != 0:
            raise RuntimeError(f"apktool recompile failed: {result.stderr}")

        return output

    def _sign(self, apk_path: Path) -> Path:
        keystore_path = Path("fdroid/keystore.p12")
        if not keystore_path.exists():
            log.warning("Keystore not found, skipping signing")
            return apk_path

        import os

        password = os.environ.get("KEYSTORE_PASSWORD", "")

        uber_apk_signer = get_jar("uber-apk-signer")
        sign_cmd = [
            "java", "-jar", str(uber_apk_signer),
            "--apks", str(apk_path),
            "--ks", str(keystore_path),
            "--ksAlias", "repokey",
            "--ksPass", password,
            "--ksKeyPass", password,
            "--allowResign",
        ]
        result = run_cmd(sign_cmd, check=False)
        if result.returncode != 0:
            log.warning("Signing failed: %s", result.stderr)
            return apk_path

        stem = apk_path.stem.replace("-unsigned", "")
        signed_path = apk_path.parent / f"{stem}-signed.apk"

        possible_names = [
            apk_path.parent / f"{apk_path.stem}-aligned-signed.apk",
            apk_path.parent / f"{apk_path.stem}-signed.apk",
            apk_path.parent / f"{stem}-aligned-signed.apk",
            apk_path.parent / f"{stem}-signed.apk",
            apk_path.parent / f"{apk_path.stem}-debugSigned.apk",
        ]

        for candidate in possible_names:
            if candidate.exists():
                candidate.rename(signed_path)
                return signed_path

        return apk_path
