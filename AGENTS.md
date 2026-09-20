# Development guidelines

## Scope and workflow

- This repository develops the GPT-Live-1 browser demo and related examples.
- Define the expected result and verification before editing. Ask when a requirement has materially different interpretations.
- Keep changes small and directly related to the task. Preserve edits made by others.
- Extend the existing Node.js and browser implementation before adding frameworks, services, or configuration options.
- Keep the Chinese and English interfaces and documentation consistent.
- Read `docs/DEVELOPMENT.md` for the module map and `docs/ROADMAP.md` for proposed priorities.

## Runtime and privacy

- Keep development data separate from an installed application's data. Follow the development setup guide.
- Never commit service keys, real endpoints, private settings, browser storage, logs, recordings, or personal machine paths.
- Credentials remain on the server. Do not return them through APIs or store them in browser storage.
- Use synthetic fixtures in tests. Do not claim provider compatibility based only on mocked tests or model discovery.
- Preserve saved user preferences when upgrading. A new default does not prove an existing session uses it.
- The live voice service handles speech; the reasoning backend and its native `web_search` tool handle delegated questions. Do not add a separate search provider without an agreed requirement.
- Keep sources and search failures visible. Do not report successful search without search-call evidence.

## Verification and publication

- Run relevant tests, `npm run check:release`, and `git diff --check`.
- For UI changes, test the actual browser in both languages. Confirm language switching preserves drafts and active media state when relevant.
- Separate fixture verification from real provider verification in the result. Keep real credentials and test artifacts outside published files.
- Read `docs/RELEASE.md` before packaging. Audit source, public history, images, and archive contents for private information.
- Create a version tag only when a release is in the agreed task scope. Documentation-only work does not need a new binary release.
