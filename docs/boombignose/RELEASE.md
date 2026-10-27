# Release assets for BoomBigNose ERP Harness AI

Repository: https://github.com/Boom-Vitt/boombignose-erp-harness-ai

`.github/workflows/boombignose-release.yml` builds the Wails window on GitHub-hosted runners:

- `BoomBigNose-windows-x64-setup.exe` from NSIS on `windows-latest`. The installer is unsigned. It installs `BoomBigNose.exe` (Windows GUI subsystem) and `bundle\` beside it: `node.exe`, `erp\server.js`, portable Postgres, `auth\auth.exe`, `postgrest\postgrest.exe`, and `ollama\ollama.exe` without the CUDA runners and without model weights. Compression is off. A silent install in CI checks those paths, then the smoke boots that directory.
- `BoomBigNose-macos-arm64.dmg` from `hdiutil` on `macos-14`, after `codesign --sign -` (ad-hoc, no purchased certificate). It contains `BoomBigNose` and `bundle/` (`node`, `erp/server.js`, portable Postgres, Auth, PostgREST, and the universal Ollama archive, including Metal). The mount check looks for the files. The smoke copies the mount to a writable directory, because a read-only UDZO image can drop the executable bit, and boots that copy.
- `BoomBigNose-linux-amd64.tar.gz` contains the Linux window binary named `BoomBigNose` and `bundle/`, including `bundle/ollama/bin/ollama` without the CUDA runners. It needs the system WebKitGTK 4.1 libraries. CI extracts the archive and smokes that tree.
- `BoomBigNose-linux-amd64.AppImage` wraps that same binary and copies `bundle/` to `usr/bin/bundle`. It also needs WebKitGTK 4.1. It does not bundle Docker. The Postgres data directory stays in the home directory. CI extracts the AppImage and smokes that tree.
- `SHA256SUMS` covers those four files.

The workflow runs on push to `main` and on pull requests. Those runs build and upload Actions artifacts. They do not publish a release.

A desktop release is created as a draft, not published:

```
gh release create boombignose-vX.Y.Z --draft --target <commit on main> --title "BoomBigNose X.Y.Z" --notes-file notes.md
```

Creating that draft starts the workflow (`release` type `created`). The workflow marks an incomplete `boombignose-v*` release as a draft so `releases/latest` stays on the previous release. Installer jobs smoke the built files. After those jobs pass, the publish job uploads the four installers and `SHA256SUMS`, then runs `gh release edit <tag> --draft=false --latest`. Publishing that release starts the workflow again, and the gate skips the build when those five assets are already present. Do not publish the draft by hand before the upload. The workflow does not create the draft itself, and it does not replace assets on any other tag.

Tag `boombignose-v0.2.0` is the window only. It does not contain `bundle/`. Tag `boombignose-v0.2.1` contains Node, `server.js`, and portable Postgres. It does not contain Auth, PostgREST, or Ollama. Tag `boombignose-v0.3.0` is a non-prerelease from commit `0652c87`. Workflow run [40549096601](https://github.com/Boom-Vitt/boombignose-erp-harness-ai/actions/runs/40549096601) packed Node, `server.js`, portable Postgres, Auth v2.197.0, PostgREST v16.5, and Ollama v0.40.11, then printed `health ok`, `signup ok`, and `signin ok` against the extracted tar.gz, the extracted AppImage, the silent NSIS directory, and a writable copy of the mounted DMG. `sha256sum -c` matched the four uploaded files. https://github.com/Boom-Vitt/boombignose-erp-harness-ai/releases/latest redirects to that tag. Tag `boombignose-v0.1.1` is the older harness command (`boombignose check` and `boombignose cutover`). These builds are compiled in CI. They have not been click-tested on a physical machine. There is no paid code-signing certificate.

The window refuses cloud model keys. When `bundle/node` and `bundle/erp/server.js` are present it starts that server. Otherwise, when `127.0.0.1:3100` is closed and it finds a checkout, it runs `node scripts/local/stack.mjs serve --port 3100`.

No code-signing certificate is required for this step.
