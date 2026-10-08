# cumba-oss-corej-rule-editor-web — release archive

This archive is the **built** coreJ rule editor SPA: static files only, no server. Its root is
the site root.

## Serving it

The SPA calls its API under `/api` **on the same origin** (session cookie + CSRF, no cross-site
handling — PLAN-rule-editor §4.2). Two supported shapes:

1. **Bundled** — hand this directory to the rest build and the rest jar serves it at `/`:

   ```bash
   mvn -Pbundle-web clean package -Dweb.dist.dir=/path/to/this/directory
   ```

   in `cumba-oss-corej-rule-editor-rest`.

2. **Two apps behind a reverse proxy** — serve these files and forward `/api` (and
   `/v3/api-docs`, `/swagger-ui.html`, `/swagger-ui/`) to the rest app. The repository's
   `docker/nginx.conf` is the reference configuration (its `Dockerfile` builds the SPA
   from the sources into the nginx image); the rest repository's `docker-compose.yml` brings both up.

⛔ A cross-site deployment (SPA on one site, API on another) is **not supported**: the session
cookie is `SameSite=Lax` and the CSRF token is session-bound.

## Verifying the download

Each release asset is signed with the same GPG key as the project's Maven Central
artifacts — one trust root, not two. A **release asset can be replaced in place** by anyone
with write access to the repository, so unlike an immutable Central artifact the signature
is the only thing standing between you and a swapped file. Check it:

```bash
gpg --verify cumba-oss-corej-rule-editor-web-<version>.zip.asc cumba-oss-corej-rule-editor-web-<version>.zip
```

Key fingerprint: `AE5AA7685BED3FC5DF4AE8DD7727EF25F931AF6B`

## Licence

Licensed under AGPL-3.0-only. Source, issues and the build:
[cumba-oss-corej-rule-editor-web](https://github.com/cumba-oss/cumba-oss-corej-rule-editor-web).
