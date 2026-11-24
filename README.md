# Jetsaw Packages

Official schemas, starter examples, and a zero-dependency validator/packager CLI for building **Jetsaw packs** and **connector plugins**.

## Package Kinds

Every Jetsaw package is distributed as `<kind>-<name>-<version>.tar.gz` (optionally accompanied by an Ed25519 `.sig` signature) containing only plain files and folders (no symbolic or hard links).

| Kind | Root Manifest | Purpose |
|---|---|---|
| `pack` | `pack.json` | Pure data (never executed code): stack rules, workflows, agents, templates, guards, commands, and defaults. |
| `plugin` | `plugin.json` | Sandboxed connector process speaking JSON-RPC 2.0 over stdio (`Content-Length` framing) for a `tracker` or `forge` port. |

## Quickstart (5 minutes)

1. Copy one of the starter folders in `examples/`:
   - `examples/stack-typescript/` — a `stack` pack with repository auto-detection, rules, guards, and QA defaults.
   - `examples/workflow-minimal/` — a `workflow` pack defining flows and agents.
   - `examples/plugin-tracker-stub/` — a minimal JSON-RPC 2.0 `tracker` connector plugin.
2. Edit `pack.json` (or `plugin.json`) — point `$schema` to `./schemas/pack.schema.json` or `./schemas/plugin.schema.json` for editor validation.
3. Validate your folder:
   ```sh
   node bin/jetsaw-pack.mjs validate examples/stack-typescript
   ```
4. Build a clean `.tar.gz` archive ready to load or publish:
   ```sh
   node bin/jetsaw-pack.mjs build examples/stack-typescript --out dist
   ```

## Publish for Your Team on Jetsaw Cloud

An organization on the Team plan publishes its packages from the Cloud dashboard, **Packages**. Private packages are seen only by the organization's members; public ones by anyone. Cloud only accepts a package signed with a key an admin registered, and Jetsaw for Mac checks each one against it.

1. Make a signing key, once per team (the private half stays with you; Cloud never sees it):
   ```sh
   node bin/jetsaw-pack.mjs keygen --out ~/.jetsaw/team-key.pem
   ```
   It prints the public key, `ed25519:…`. An admin pastes it in **Packages → Signing keys → Add key**.
2. Build and sign your package (`--key` writes `<archive>.tar.gz.sig` beside the archive):
   ```sh
   node bin/jetsaw-pack.mjs build my-pack --out dist --key ~/.jetsaw/team-key.pem
   ```
   An archive built earlier is signed with `node bin/jetsaw-pack.mjs sign dist/<archive>.tar.gz --key ~/.jetsaw/team-key.pem`.
3. In **Packages → Publish a package**, upload the `.tar.gz` and its `.sig` and choose **Private**. A published version never changes: to fix it, bump `version` and publish again.

Members then find it in Jetsaw for Mac, **Settings → Packages**, with a button to install it.

## Pack Types & Allowed Contents

A pack's `type` fixes which top-level folders, dependencies, and project `defaults` it may provide:

| `type` | Allowed folders | Allowed `defaults` | May `depends` on |
|---|---|---|---|
| `stack` | `knowledge/` (`rules/`, `snippets/`), `agents/` (must declare `appliesTo`), `guard/`, `commands/` | `qa` (plus `detect`) | `stack` |
| `integration` | `knowledge/` (`rules/`, `snippets/`), `guard/`, `commands/` | `tracker`, `forge` | `stack`, `integration` |
| `workflow` | `knowledge/` (`rules/`, `snippets/`), `skills/`, `agents/`, `flows/`, `templates/`, `guard/`, `commands/`, `evals/` | `autonomy`, `flows` | `stack`, `integration`, `workflow` |
| `bundle` | *(meta-pack: composes other packs via `depends`)* | any except `schema`, `name`, `repositories`, `packs` | any pack type |

> **Note:** `knowledge/context`, `knowledge/glossary`, and `knowledge/landmines` belong to individual projects, never to reusable packs.

## Connector Plugin Protocol (`protocol: "^1"`)

Connector plugins run as isolated child processes communicating over `stdin`/`stdout` using LSP-style `Content-Length: <bytes>\r\n\r\n<json>` frames (logs go to `stderr`):

- Lifecycle: `initialize` → capability requests → `shutdown` → `exit` (plus `$/cancelRequest`).
- Declare exact `permissions` (`hosts`, `executables`, `credentials`) in `plugin.json`; Jetsaw enforces them in the sandbox after explicit user approval.

## License

MIT — see [LICENSE](./LICENSE).
