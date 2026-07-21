# Releasing

The repo ships to npm via `.github/workflows/publish.yml` when a **GitHub Release**
is published. Do the one-time setup below and you never touch an npm token again.

## One-time: enable Trusted Publishing (no token, signed with provenance)

1. Go to npmjs.com → the `binance-smart-money-oi-monitor` package → **Settings → Trusted Publisher**.
2. Add a GitHub Actions publisher:
   - Repository: `0xBennie/binance-smart-money-oi-monitor`
   - Workflow: `publish.yml`
3. That's it. `publish.yml` already requests OIDC (`id-token: write`) and runs
   `npm publish --provenance`, so releases publish with a verified provenance badge — no `NPM_TOKEN` secret needed.

> If you ever pasted an npm token anywhere (chat, CI logs), **revoke it** at
> npmjs.com → Access Tokens. Trusted Publishing means you don't need one.

## Cutting a release

1. Bump the version. `npm version --no-git-tag-version X.Y.Z` updates
   `package.json` + `package-lock.json`, then update the two spots that DON'T
   auto-follow: `SERVER_INFO` in `src/mcp-core.ts` and the version strings in
   `test/mcp-core.test.ts` + `test/docs-contract.test.ts`. Add a `## X.Y.Z`
   entry to `CHANGELOG.md`. `npm test` (the docs-contract test) enforces that
   all of these match.
2. Merge to `main`.
3. Create a GitHub Release on a `vX.Y.Z` tag with notes:
   ```bash
   git tag -a v1.7.0 -m "…" && git push origin v1.7.0
   gh release create v1.7.0 --title "…" --notes "…"
   ```
4. `publish.yml` fires, builds (`prepublishOnly` → `tsc`), and publishes.
   - It **skips cleanly** if the version is already on npm (so re-triggering a
     release on a published version is a green no-op, not a failed duplicate).

## Local checks before releasing

```bash
npm run typecheck && npm test        # TS
python3 -m unittest discover altmonitor -p 'test_*.py' 2>/dev/null || (cd altmonitor && python3 -m unittest test_env_io test_ssh_util test_tg_probe test_links)
npm pack --dry-run                   # inspect the tarball
```
