# pi-playwriter

Native [Pi](https://pi.dev/) package that registers a `playwriter` tool for the [Playwriter CLI](https://github.com/remorses/playwriter).

The repository is intended to stay private until you are ready to publish, but its package metadata, `files`, CI, release workflow, and npm provenance flow are ready for npm publishing.

## Install locally

```bash
pi install ~/workspace/pi-playwriter
# or for a one-off run:
pi -e ~/workspace/pi-playwriter
```

## Tool

The package registers one native Pi tool:

- `playwriter`

Supported actions:

| Action | Purpose |
| --- | --- |
| `doctor` | Inspect Node/npm/Playwriter installation, version, npm latest, sessions, and usage instructions. |
| `update` | Install/update the Playwriter CLI. Defaults to `npm install --global playwriter@latest`. |
| `eval` | Run JavaScript through `playwriter --eval`. Can auto-create a session when none is supplied. |
| `session_new` | Run `playwriter session new`. |
| `session_list` | Run `playwriter session list`. |
| `session_delete` | Run `playwriter session delete <session>`. |
| `session_reset` | Run `playwriter session reset <session>`. |
| `skill` | Print Playwriter usage instructions. |
| `logfile` | Print the Playwriter relay logfile path. |
| `version` | Print `playwriter --version`. |

### Example prompts

```text
Run playwriter doctor and fix any installation issue you find.
```

```text
Use playwriter to create a browser session and inspect the title of the current page.
```

The model should call:

```json
{
  "action": "eval",
  "code": "console.log(await page.title())"
}
```

## Development

This repo mimics the installed Pi packages in this environment:

- `pi-codex-goal`: TypeScript extension under `src/`, `pi.extensions`, `verify = typecheck + test`, npm-ready `files` metadata.
- `pi-subagents`: separate test and release workflows, GitHub Actions publishing via `npm publish --provenance`.
- `pi-web-access`: single extension package shape with `pi-package` keywords.
- `@juicesharp/rpiv-todo` and `@agnishc/edb-agent-steer`: package metadata style for Pi extension packages.

Commands:

```bash
npm install
npm run typecheck
npm test
npm run verify
npm run pack:dry
```

## Publishing

When the private repository is ready to publish publicly:

1. Create/push the private GitHub repository at `git@github.com:hugooliveirad/pi-playwriter.git` or update `package.json` repository metadata.
2. Confirm `npm run verify` and `npm run pack:dry` pass.
3. Trigger `.github/workflows/release.yml` manually.

The release workflow uses npm trusted publishing/provenance (`npm publish --provenance`).
