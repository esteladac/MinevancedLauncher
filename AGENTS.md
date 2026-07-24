# MinevancedLauncher - Project Context

> Give this file to any AI assistant before starting work on this project.
> It contains everything needed to understand the codebase, conventions, and workflows.

---

## What This Project Is

MinevancedLauncher is a Minecraft launcher designed for sharing modpacks. It has three main components:

1. **Electron Client** (`src/`) — The launcher UI users run on their desktop
2. **Express Server** (`server/`) — Backend with auth, modpack management, admin panel
3. **Admin Panel** (`server/src/admin/index.html`) — Web-based admin dashboard served by the server

### Tech Stack

| Component | Technology |
|-----------|-----------|
| Client | Electron 42 + vanilla JS (no framework) |
| UI | Single-file `index.html` + `style.css` (no build step) |
| Game engine | `minecraft-launcher-core` (MCLC) in a forked child process |
| Mod loaders | `tomate-loaders` v2 (Fabric, Quilt, Forge, NeoForge) |
| Auth | Discord OAuth (premium) + Microsoft Auth (`msmc`) |
| Server | Express + SQLite (`better-sqlite3`) + Multer (uploads) |
| Admin panel | Single monolithic `index.html` with vanilla JS |
| Build | `electron-builder` → portable `.exe` |

---

## File Structure

```
MinevancedLauncher/
├── src/
│   ├── main.js              # Electron main process (~2700 lines) — ALL backend logic
│   ├── index.html            # Electron renderer — entire UI (~2100 lines)
│   ├── style.css             # All styles (~900 lines)
│   ├── launch-process.js     # Forked child process for MCLC (avoids blocking Electron)
│   ├── .builtin-packs.json   # Built-in modpack definitions (shipped with client)
│   └── lang_*.json           # i18n translation files
├── server/
│   ├── src/
│   │   ├── index.js          # Express server entry
│   │   ├── config.js         # Env config (port, Discord, admin, dbPath, serverUrl)
│   │   ├── db/
│   │   │   └── schema.js     # SQLite schema + migrations
│   │   ├── routes/
│   │   │   ├── api.js        # Public API (modpacks list, manifests, updates)
│   │   │   ├── auth.js       # Discord OAuth + Microsoft Premium auth
│   │   │   ├── modpacks.js   # Modpack CRUD, manifest building, invite codes, cover uploads
│   │   │   ├── admin.js      # Admin auth + admin-only endpoints
│   │   │   └── bug-reports.js
│   │   ├── admin/
│   │   │   └── index.html    # Admin panel (monolithic, ~2300 lines)
│   │   └── auth/             # Auth middleware
│   ├── data/                 # SQLite DB + uploaded mods/covers (gitignored)
│   ├── .env                  # Environment variables (gitignored)
│   └── .env.example          # Template
└── package.json              # Client version
```

---

## Versioning System

### Client and server version INDEPENDENTLY

| Component | Current Version | Location |
|-----------|----------------|----------|
| Client (Electron) | `1.3.1` | `package.json` → `version` |
| Server | `1.0.0` | `server/package.json` → `version` |

### Version scheme: `A.B.C`

- **A** = Big versions (major rewrites). Only 1 so far.
- **B** = New functions, UI changes, features. Bump on every meaningful change.
- **C** = Little fixes, bug fixes, tweaks. Bump on every small fix.

### When to bump what
- Electron UI change or new feature → bump **client** `B`
- Server route/DB change → bump **server** `B`
- Bug fix in client → bump client `C`
- Bug fix in server → bump server `C`
- If both client and server changed → bump **both**

---

## Commit Conventions

### Commit messages format

Every commit message MUST follow this pattern:

```
vX.Y.Z: Short description of what changed
```

Examples:
```
v1.3.3: Pass modLoaderVersion through launch flow, smooth progress bar with structured IPC
v1.3.2: Separate client/server versioning - client 1.3.1, server reset to 1.0.0
v1.3.1: Fix NeoForge loader version fetching - use maven metadata XML with correct version prefix mapping
```

For smaller commits or WIP:
```
feat: short description
fix: short description
```

### Auto-commit workflow

When the user says "commit" or "commit everything":
1. Run `git add` on all modified files
2. Run `git commit -m "vX.Y.Z: description"` (use the next version number)
3. Don't push unless asked
4. Never add secrets, `.env`, `node_modules`, or database files

### Branch

Everything is on `main`. There's only one branch.

---

## Code Conventions

### General rules
- **No comments in code** unless the user explicitly asks for them
- **No framework** — vanilla JS everywhere (no React, Vue, etc.)
- **Single-file architecture** — the admin panel is one monolithic HTML file, the launcher UI is one monolithic HTML file
- **No build step** — everything runs directly, no webpack/vite/etc.

### IPC Communication (Client ↔ Server)

The Electron app uses two IPC patterns:

1. **`ipcRenderer.send` / `ipcMain.on`** — Fire-and-forget from renderer to main
2. **`ipcRenderer.invoke` / `ipcMain.handle`** — Request/response pattern

Progress/status uses `safeSend(channel, data)` from main → renderer:
- `update-progress` — Structured: `{ percent: number, message: string }` — drives the progress bar
- `update-status` — Text only — updates the status label (fallback)
- `launch-error` — `{ title: string, message: string }`
- `game-closed` — No data, resets UI
- `game-log` — Game stdout/stderr lines
- `game-crash-with-deps` — Dependency conflict errors

### Progress Bar System

The progress bar uses a **phase-weighted** system:

| Phase | Weight Range | Trigger |
|-------|-------------|---------|
| Manifest fetch | 0–5% | Server response |
| Mod sync | 5–35% | Per-mod download |
| File sync | 35–50% | Per-file download |
| Loader setup | 50–60% | tomate-loaders config |
| Java prep | 60–65% | getJavaPortable() |
| Engine verify | 65–98% | MCLC progress events |
| Game running | 100% | "Setting user:" or `launched` fallback |

A **minimum progress timer** (0.3% per 500ms) ensures the bar never gets stuck.
An **indeterminate shimmer** activates on the renderer side after 2s with no update.

### Modrinth API

- Facets must be URL-encoded JSON arrays: `[["categories:fabric"],["versions:1.21.1"]]`
- Backend field names: `name`, `download_url` (NOT `mod_name`, `url`)
- Cover images can be base64 data URLs or file paths — `buildManifest` checks for both `http` and `data:` prefixes

### NeoForge Versioning

NeoForge does NOT support the `latest` keyword in `tomate-loaders`. It requires specific versions.
- MC `1.X.Y` → NeoForge prefix `X.Y` (e.g., MC `1.21.1` → `21.1.*`)
- Maven URL: `https://maven.neoforged.net/releases/net/neoforged/neoforge/`

### Forge Versioning
- Maven URL: `https://maven.minecraftforge.net/net/minecraftforge/forge/`
- Version format: `1.21.1-47.3.0`

### Fabric/Quilt Versioning
- Fabric API: `https://meta.fabricmc.net/v2`
- Quilt API: `https://meta.quiltmc.org/v3/`
- Support `latest` keyword — but the manifest should store the actual version
- `fabric.getProfile(gameVersion, loaderVersion)` accepts a specific version
- `getMCLCLaunchConfig()` always uses the LATEST version (never use it when a specific version is needed)

### `tomate-loaders` Library

Located in `node_modules/tomate-loaders/`. Key functions:
- `fabric.getProfile(gameVersion, loaderVersion)` — fetches specific version profile
- `fabric.getLoaders()` — lists available versions
- `forge.getMCLCLaunchConfig(config)` — always uses latest
- `neoforge.getMCLCLaunchConfig(config)` — always uses latest
- The launcher implements custom version-specific loading when `modLoaderVersion` is set

---

## Server Configuration

Environment variables (see `server/.env.example`):
- `PORT` — Server port (default: 8080)
- `SERVER_URL` — Public URL used to build manifest download URLs
- `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` — Discord OAuth
- `ADMIN_PASSWORD` — Admin panel password (SHA-256 hashed)
- `SESSION_EXPIRY_HOURS` — User session duration (default: 72h)
- `ADMIN_SESSION_EXPIRYHours` — Admin session duration (default: 24h)

### Database

SQLite at `server/data/minevanced.db` (gitignored).
Schema in `server/src/db/schema.js`. Key tables:
- `modpacks` — pack_id, name, mod_loader, loader_version, minecraft_version, is_published, is_builtin
- `modpack_mods` — modpack_id, name, version, download_url, file_path, hash, sort_order
- `invite_codes` — code, modpack_id, is_active, max_uses, use_count

### Manifest Structure

Built by `buildManifest()` in `server/src/routes/modpacks.js`:
```json
{
  "id": "pack-slug",
  "name": "Display Name",
  "minecraftVersion": "1.21.1",
  "modLoader": "fabric",
  "modLoaderVersion": "0.16.14",
  "description": "...",
  "coverImage": "http://... or data:...",
  "author": "...",
  "version": "1.0.0",
  "mods": [{ "name": "...", "version": "...", "downloadUrl": "..." }],
  "files": []
}
```

---

## Common Tasks & How to Do Them

### Adding a new server route
1. Edit `server/src/routes/` — add route to appropriate file or create new
2. If new file, import in `server/src/index.js`
3. Bump server version in `server/package.json`

### Adding a new client feature
1. UI goes in `src/index.html`
2. Logic goes in `src/main.js` (IPC handlers)
3. Styles go in `src/style.css`
4. Bump client version in `package.json`

### Adding a new admin panel feature
1. Everything goes in `server/src/admin/index.html`
2. Admin API calls use the `api()` helper function defined in that file
3. Backend routes go in `server/src/routes/admin.js` or `server/src/routes/modpacks.js`

### Modrinth mod search
- Facets format: `[["categories:fabric"],["versions:1.21.1"]]` — must be URL-encoded
- Backend proxy at `/admin/api/modrinth/search`
- Cover images: check for `http` or `data:` prefix before prepending `serverUrl`

### Launch flow (`src/main.js`)
1. Validate payload
2. Resolve instance name (minevanced → minevanced-modded or minevanced-optimized)
3. Fetch manifest (dev local → builtin → server)
4. Sync mods (download missing/outdated)
5. Sync files (configs, resourcepacks)
6. Resolve modloader (fabric/forge/neoforge/vanilla)
7. Prepare Java (portable Java management)
8. Fork `launch-process.js` → MCLC client.launch()
9. Listen for progress/data/close events

---

## Known Gotchas

- The admin panel HTML is massive (~2300 lines) — be careful with edits, test manually
- `main.js` is ~2700 lines — everything lives here (IPC, downloads, game launch, auth, mods)
- The `download-tracker` div in `index.html` uses class `hidden` to show/hide — always use `classList.remove('hidden')` to show, NOT `classList.add('hidden')`
- MCLC runs in a forked process (`launch-process.js`) to avoid freezing the Electron renderer
- `safeSend()` is the ONLY way to send IPC from main to renderer — it checks if the window is alive first
- Portable Java is managed per MC version — newer MC needs Java 21+, older needs Java 8/17
- The launcher stores game instances in `getLauncherDataPath()/<instanceName>/`
