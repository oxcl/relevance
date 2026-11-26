the system is running NixOS. you are expected to use flake.nix and `nix develop` if you need to install any package or program that is not accessible to you already.

when it comes to designing UI, transition states, interaction animations, hovers, clicks, between page transitions, dyanimc effects of the UI you must be unreasonably ambitious. aim for visual excellence.

you can call codex from command line if you want to generate images with this command:
codex exec --skip-git-repo-check -s workspace-write "<prompt>"
in the prompt instruct codex where you want the image to be saved.

gh, wrangler, bun tools are installed through flake.nix and logged in and ready to be used.

you are the only developer working on this project. you have 100% ownership. 

please verify that your output works. you are 100% permitted to publish and deploy with wrangler, push to github. do database manipulations in any shape you want. use gh to work strictly with the oxcl/relevance repo. verify frontend in a browser.

don't forget to commit your work and push to the github repo as you progress
