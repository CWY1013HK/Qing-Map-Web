# Password-gated map editor (`/editor`)

Local editing runs only on the Vite dev server (`npm run dev`). The public site at `/` stays read-only even in dev. Collaborators open `/editor`, sign in with an individual password, and use the same vertex / annotation tools as before.

## Invite an editor

```bash
npm run editor-password -- add "Ada Lovelace"
```

Stdout prints a one-time plaintext password and an `ed-…` id. Share the password and the URL out of band (for example `http://<your-lan-ip>:5173/editor`).

Optionally keep a local ledger at the repo root — **`EDITOR-PASSWORDS.md`** and **`EDITOR-PASSWORDS.example.md`** are both **gitignored** and must not be committed. Create either file locally if you want a plaintext record (the server only stores hashes).

Suggested `EDITOR-PASSWORDS.md` layout:

```markdown
# Editor passwords (local only)

## Active credentials
| Name | Editor id | Granted (UTC) | Password | Notes |

## Revoked
| Name | Editor id | Granted | Revoked (UTC) | Notes |
```

## List and revoke

```bash
npm run editor-password -- list
npm run editor-password -- revoke ed-abc123
```

`list` shows id, name, grant time (`createdAt`), and whether the credential is active or revoked.

## Logs

| File | Purpose |
|------|---------|
| `data/editor/editors.json` | Hashed passwords and metadata (not committed) |
| `data/editor/grants.jsonl` | Append-only **grant** and **revoke** events with name and `grantedAt` |
| `data/editor/audit.jsonl` | Append-only **edit** events (saves, annotation changes) with `editorId` and `editorLabel` |

Plaintext passwords are not written by the dev server (only scrypt hashes in `data/editor/`). Any root-level password notes are your local files only.

## Sign-in flow

1. Browser loads `/editor`.
2. `GET /__dev/editor/session` — returns 401 or the signed-in editor name.
3. `POST /__dev/editor/login` with `{ "password": "…" }` sets an httpOnly session cookie (7 days).
4. All `POST /__dev/*` API calls require that cookie.

Sign out uses the control at the top-right of `/editor`, which calls `POST /__dev/editor/logout`.
