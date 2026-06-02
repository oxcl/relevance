{ system ? builtins.currentSystem }:

let
  pkgs = import <nixpkgs> {
    inherit system;
    config = {
      android_sdk.accept_license = true;
      allowUnfree = true;
    };
  };

  python = pkgs.python312;

  buildToolsVersion = "33.0.2";
  androidComposition = pkgs.androidenv.composeAndroidPackages {
    buildToolsVersions = [ buildToolsVersion ];
    platformVersions = [ "33" ];
  };
in
pkgs.mkShell {
  buildInputs = [
    python
    python.pkgs.pyyaml
    python.pkgs.pydantic
    python.pkgs.httpx
    python.pkgs.pillow
    python.pkgs.click
    python.pkgs.rich
    python.pkgs.jinja2
    python.pkgs.ruff
    python.pkgs.mypy
    python.pkgs.build
    python.pkgs.setuptools
    python.pkgs.venvShellHook
    python.pkgs.curl-cffi

    pkgs.jdk17
    pkgs.fdroidserver
    pkgs.actionlint
    pkgs.gh
    pkgs.apkeep

    androidComposition.androidsdk

    pkgs.zlib
    pkgs.libjpeg
    pkgs.libpng
    pkgs.stdenv.cc.cc.lib
    pkgs.git
    pkgs.curl
    pkgs.wget
    pkgs.unzip
    pkgs.zip
  ];

  shellHook = ''
    export RELEVANCE_TOOLS_DIR="''${RELEVANCE_TOOLS_DIR:-$PWD/.tools}"
    mkdir -p "$RELEVANCE_TOOLS_DIR"

    export LD_LIBRARY_PATH="${pkgs.stdenv.cc.cc.lib}/lib:''${LD_LIBRARY_PATH:-}"

    export ANDROID_HOME="${androidComposition.androidsdk}/libexec/android-sdk"
    export PATH="$ANDROID_HOME/build-tools/${buildToolsVersion}:$PATH"

    # GitHub CLI token
    if [ -n "$GITHUB_TOKEN" ]; then
      export GH_TOKEN="$GITHUB_TOKEN"
    fi

    if [ ! -d "$PWD/.venv" ]; then
      ${python}/bin/python3 -m venv "$PWD/.venv"
    fi
    source "$PWD/.venv/bin/activate"

    pip install --quiet justapk 2>/dev/null || true
  '';
}
