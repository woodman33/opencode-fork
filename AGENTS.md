- To test opencode in `packages/opencode`, run `bun dev`.
- To regenerate the JavaScript SDK, run `./packages/sdk/js/script/build.ts`.
- ALWAYS USE PARALLEL TOOLS WHEN APPLICABLE.
- The default branch in this repo is `dev`.

## Cursor Cloud specific instructions

- **Bun must be on PATH**: Run `export PATH="$HOME/.bun/bin:$PATH"` before any bun command if you get "bun not found".
- **Run the server headless**: Use `bun run --cwd packages/opencode --conditions=browser src/index.ts serve --port 4096` to start the API server without a TUI. Verify with `curl http://127.0.0.1:4096/global/health`.
- **Typecheck**: `bun turbo typecheck` from root. Uses `tsgo` (native TypeScript compiler).
- **Tests**: `bun test` in `packages/opencode`. Some snapshot/worktree tests timeout in CI-like environments (pre-existing, not a setup issue).
- **Pre-push hook**: Checks bun version matches `package.json` `packageManager` field, then runs typecheck.
- **No LLM key needed for dev server**: The server starts and serves the web UI + API without any provider keys. Keys are only needed to actually run AI inference in sessions.
- See `CONTRIBUTING.md` for full development workflows and style guide.
