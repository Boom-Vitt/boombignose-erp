# Release assets

`.github/workflows/boombignose-release.yml` builds installers on GitHub-hosted runners:

- `BoomBigNose-windows-x64-setup.exe` from NSIS on `windows-latest`. The installer is unsigned.
- `BoomBigNose-macos-arm64.dmg` from `hdiutil` on `macos-14`, after `codesign --sign -` (ad-hoc, no purchased certificate).
- `BoomBigNose-linux-amd64.tar.gz` from a linux/amd64 Go build. Linux is the secondary platform and is included in `SHA256SUMS`.

On a pull request the workflow only builds and uploads Actions artifacts. It creates or updates a GitHub Release only for `workflow_dispatch` or for an already published release. The dispatch tag is `boombignose-v0.1.1` when no release tag was provided. `SHA256SUMS` is generated from the three files after those jobs succeed.

The files contain the `boombignose` command, which checks the environment and prints the cutover plan. They do not open a Wails window. The landing page links these filenames and says they are the harness command.

No code-signing certificate is required for this step.
