# Release assets for BoomBigNose ERP Harness AI

Repository: https://github.com/Boom-Vitt/boombignose-erp-harness-ai

`.github/workflows/boombignose-release.yml` builds the Wails window on GitHub-hosted runners:

- `BoomBigNose-windows-x64-setup.exe` from NSIS on `windows-latest`. The installer is unsigned. The installed file is `BoomBigNose.exe` with the Windows GUI subsystem.
- `BoomBigNose-macos-arm64.dmg` from `hdiutil` on `macos-14`, after `codesign --sign -` (ad-hoc, no purchased certificate).
- `BoomBigNose-linux-amd64.tar.gz` contains the Linux window binary named `BoomBigNose`. It needs the system WebKitGTK 4.1 libraries.
- `BoomBigNose-linux-amd64.AppImage` wraps that same binary. It also needs WebKitGTK 4.1. It does not bundle Node, Docker, Postgres, or Ollama.
- `SHA256SUMS` covers those four files.

On a pull request the workflow only builds and uploads Actions artifacts. It uploads assets only for a published release whose tag matches `boombignose-v*`. It does not create a release by itself, and it does not replace assets on any other tag.

Tag `boombignose-v0.1.1` is the older harness command (`boombignose check` and `boombignose cutover`). A later `boombignose-v*` tag built from this workflow is the window. These builds are compiled in CI. They have not been click-tested on a physical machine.

The window refuses cloud model keys. When `127.0.0.1:3100` is closed and it finds a checkout, it runs `node scripts/local/stack.mjs serve --port 3100`. The installer does not contain that checkout.

No code-signing certificate is required for this step.
