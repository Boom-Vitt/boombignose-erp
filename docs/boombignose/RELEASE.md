# Release assets for BoomBigNose ERP Harness AI

Repository: https://github.com/Boom-Vitt/boombignose-erp-harness-ai

`.github/workflows/boombignose-release.yml` builds the Wails window on GitHub-hosted runners:

- `BoomBigNose-windows-x64-setup.exe` from NSIS on `windows-latest`. The installer is unsigned. It installs `BoomBigNose.exe` (Windows GUI subsystem) and `bundle\` beside it: `node.exe`, `erp\server.js`, and portable Postgres. Compression is off. A silent install in CI checks those paths.
- `BoomBigNose-macos-arm64.dmg` from `hdiutil` on `macos-14`, after `codesign --sign -` (ad-hoc, no purchased certificate). It contains `BoomBigNose` and `bundle/` (`node`, `erp/server.js`, portable Postgres). The mount check looks for the files and does not boot the server from the image.
- `BoomBigNose-linux-amd64.tar.gz` contains the Linux window binary named `BoomBigNose` and `bundle/`. It needs the system WebKitGTK 4.1 libraries.
- `BoomBigNose-linux-amd64.AppImage` wraps that same binary and copies `bundle/` to `usr/bin/bundle`. It also needs WebKitGTK 4.1. It does not bundle Docker or Ollama. The Postgres data directory stays in the home directory.
- `SHA256SUMS` covers those four files.

The workflow runs on push to `main` and on pull requests. Those runs build and upload Actions artifacts. They upload release assets only for a published release whose tag matches `boombignose-v*`. The workflow does not create a release by itself, and it does not replace assets on any other tag.

Tag `boombignose-v0.2.0` is the window only. It does not contain `bundle/`. Tag `boombignose-v0.1.1` is the older harness command (`boombignose check` and `boombignose cutover`). These builds are compiled in CI. They have not been click-tested on a physical machine. There is no paid code-signing certificate. v0.3.0 is not published. It waits until the Windows, macOS, and Linux installers contain the bundle and the health and sign-in smokes are green.

The window refuses cloud model keys. When `bundle/node` and `bundle/erp/server.js` are present it starts that server. Otherwise, when `127.0.0.1:3100` is closed and it finds a checkout, it runs `node scripts/local/stack.mjs serve --port 3100`.

No code-signing certificate is required for this step.
