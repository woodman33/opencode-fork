- To test opencode in `packages/opencode`, run `bun dev`.
- To regenerate the JavaScript SDK, run `./packages/sdk/js/script/build.ts`.
- ALWAYS USE PARALLEL TOOLS WHEN APPLICABLE.
- The default branch in this repo is `dev`.

## Cursor Cloud specific instructions

### Runtime
- Bun v1.3.5 is the required runtime/package manager (`packageManager` field in root `package.json`). It is installed to `~/.bun/bin/bun` and must be on `PATH`.
- Node.js >= 22 is also available and used by some packages.

### Key commands (see `CONTRIBUTING.md` for full details)
- **Install deps**: `bun install` (from repo root)
- **Typecheck**: `bun turbo typecheck` (uses `tsgo` for most packages)
- **Tests**: `bun test` (from `packages/opencode` only; root `bun test` intentionally errors)
- **Dev TUI**: `bun dev` (from repo root; runs the opencode CLI/TUI)
- **Headless server**: `bun run --cwd packages/opencode --conditions=browser src/index.ts serve --port 4096`
- **Web UI**: accessible at the server URL when running the headless server
- **Prettier**: `npx prettier --check .` for format checking

### Gotchas
- The pre-push hook (`bun typecheck`) verifies the exact Bun version matches `package.json`'s `packageManager` field. Mismatched versions will block pushes.
- Root `package.json` has `trustedDependencies` for native builds (esbuild, tree-sitter, etc.). If `bun install` fails on native deps, ensure these are listed.
- Tests only run in `packages/opencode` — the root `test` script exits with an error by design.
- The `serve` command warns about `OPENCODE_SERVER_PASSWORD` not being set; this is expected in dev. Set it if testing auth flows.
- Web app (`packages/app`) dev server: `bun run --cwd packages/app dev` (serves on localhost:5173).
- AI provider API keys (e.g., `ANTHROPIC_API_KEY`) are required to actually use the coding agent features but not for running tests or typecheck.
