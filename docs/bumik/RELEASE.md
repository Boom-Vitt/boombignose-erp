# Release assets

`.github/workflows/bumik-release.yml` builds two installers on GitHub-hosted runners:

- `BumikNodeERP-windows-x64-setup.exe` from NSIS on `windows-latest`. The installer is unsigned.
- `BumikNodeERP-macos-arm64.dmg` from `hdiutil` on `macos-14`, after `codesign --sign -` (ad-hoc, no purchased certificate).

A Linux tarball is built with `continue-on-error: true` and is not required for the release.

On a pull request the workflow only builds and uploads Actions artifacts. It creates or updates a GitHub Release only for `workflow_dispatch` or for an already published release. The dispatch tag is `bumik-v0.1.0` when no release tag was provided. `SHA256SUMS` is generated from the two installer files after both jobs succeed.

The files contain the `bumik` command, which checks the environment and prints the cutover plan. They do not open a Wails window. The landing page keeps the download buttons on “coming soon” until a windowed build exists.

No code-signing certificate is required for this step.
