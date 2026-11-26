{
  description = "relevance dev environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { nixpkgs, flake-utils, ... }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; config.allowUnfree = true; };
      in
      {
        devShells.default = pkgs.mkShell {
          packages = with pkgs; [
            wrangler
            gh
            bun
            nodejs_22
            jdk21_headless
            apktool
            apksigner
            libwebp
            imagemagick
            python3
          ];
        };
      });
}
