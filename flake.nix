{
  description = "Relevance — OpenCode-driven Morphe Android Patcher & F-Droid Repository Pipeline";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs = { self, nixpkgs }:
    let
      supportedSystems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
      forAllSystems = nixpkgs.lib.genAttrs supportedSystems;
    in
    {
      devShells = forAllSystems (system:
        let
          pkgs = import nixpkgs {
            inherit system;
            config.allowUnfree = true;
          };
          pythonEnv = pkgs.python3.withPackages (ps: with ps; [
            pyyaml
            pydantic
            httpx
            pillow
            click
            rich
            jinja2
            pytest
            setuptools
            build
          ]);
        in
        {
          default = pkgs.mkShell {
            packages = [
              pythonEnv
              pkgs.ruff
              pkgs.mypy
              pkgs.jdk21_headless
              pkgs.gh
              pkgs.jq
              pkgs.yq-go
              pkgs.actionlint
              pkgs.apkeep
              pkgs.fdroidserver
              pkgs.git
              pkgs.curl
              pkgs.wget
              pkgs.unzip
              pkgs.zip
            ];

            shellHook = ''
              export RELEVANCE_TOOLS_DIR="''${RELEVANCE_TOOLS_DIR:-$PWD/.tools}"
              mkdir -p "$RELEVANCE_TOOLS_DIR"
              export PYTHONPATH="$PWD''${PYTHONPATH:+:$PYTHONPATH}"
            '';
          };
        });
    };
}
