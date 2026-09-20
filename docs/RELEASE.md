# Release checklist

[简体中文](RELEASE.zh-CN.md) | English

This project publishes source on GitHub and can publish a self-contained Windows x64 ZIP. The current release is `v0.3.0`; use the same process for each new tag.

## Before a release

From a clean checkout:

1. Run `npm ci`.
2. Run `npm test`.
3. Run `npm run check:release`.
4. Check `git status` and `git diff --check`.
5. Confirm that `.env`, settings files, logs, screenshots, audio, tests, and local paths are absent from the files to be published.
6. Check that the README language links, deployment links, license, and release notes describe the same version and behavior.

The source and release package must not contain service keys, setup tokens, administrator passwords, personal endpoints, private paths, or local conversation data.

## Build the Windows ZIP

Run this from the project root. Use a new empty output location for every build:

```text
npm run build:release -- --out-dir ../releases/gpt-live-1-demo-vX.Y.Z
```

The builder:

- Copies only the reviewed application allowlist, `public`, and `docs`.
- Downloads the pinned official Node.js 24 Windows x64 runtime.
- Checks the downloaded archive against the official `SHASUMS256.txt` and the pinned SHA-256.
- Installs production dependencies with the bundled runtime.
- Writes the root-level `Start.cmd` launcher.
- Creates `<package-name>-<package-version>-windows-x64.zip` beside the output directory.

The package must keep `Start.cmd`, `runtime`, and `app` together. Do not upload `app` by itself and do not copy a local `.env` or application-data directory into the package. The builder refuses to reuse an existing output directory or archive so that an old package cannot be silently overwritten.

Inspect the archive before uploading. For a package built with version `0.2.0`, the filename will be `gpt-live-1-demo-0.2.0-windows-x64.zip`:

```text
tar -tf ../releases/gpt-live-1-demo-0.2.0-windows-x64.zip
```

The exact relative path depends on the output directory chosen above. The listing should contain `Start.cmd`, `runtime`, and `app`, and must not contain `.env`, tests, logs, or user data.

## Windows smoke test

Use a Windows machine or clean user directory without Node.js installed:

1. Extract the complete ZIP.
2. Double-click `Start.cmd`.
3. Confirm the browser opens the local setup page.
4. Enter a test live voice service and run the connection test.
5. Select a microphone and confirm input-level and playback tests.
6. Connect, speak, receive audio, inspect timestamped transcript lines, mute, disconnect, and reconnect.
7. Close and reopen the app; confirm settings remain in the system application-data directory rather than the ZIP directory.

Use test credentials that can be revoked. Do not save a real personal key in a screenshot, log, issue, or release asset.

## GitHub Actions release

The CI workflow runs on pushes and pull requests. It tests Node.js 22 and 24, runs the release scan, builds the Docker image, starts an empty local container, and checks health and the setup page.

The Windows release workflow runs for a `v*` tag or manual dispatch. It installs dependencies, runs tests and the release scan, builds the Windows package, uploads the ZIP artifact, calculates `SHA256SUMS.txt`, and creates the tagged GitHub Release with `docs/RELEASE-NOTES.md` as its notes when a tag is pushed.

Before pushing a tag:

1. Update `package.json` and `package-lock.json` to the intended version.
2. Update `docs/RELEASE-NOTES.md` and both README language versions if user-visible behavior changed.
3. Commit and push the source changes.
4. Create and push the exact tag, for example `v0.3.0`.
5. Check the workflow logs, uploaded ZIP, SHA-256 file, and release page.

The Docker CI smoke test proves that an empty local container starts and serves its health/setup endpoints. It does not prove that a provider account works, that browser microphone permissions work on a deployed host, or that the Render template has been live deployed.

## Render note

`render.yaml` is a deployment template with a paid Starter service and a persistent disk. It is not part of the Windows release smoke test. If a maintainer deploys it, record the actual deployment result separately and verify HTTPS, setup authentication, persistent `/data`, and microphone access before describing it as live.

## Version changes

When changing the pinned Node.js runtime, update its version and fixed SHA-256 in `scripts/build-release.mjs`, then rebuild and inspect a fresh archive. When dependencies change, commit the regenerated lockfile. Every release needs a new privacy scan, test run, Docker smoke test, and Windows package smoke test.
