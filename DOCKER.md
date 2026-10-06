# Running the rule editor with Docker — step by step

The rule editor is two apps: `cumba-oss-corej-rule-editor-rest` (the API, Java) and this SPA
(`cumba-oss-corej-rule-editor-web`). `docker-compose.yml` in the **rest** repo runs them as
two containers:

| container          | image built from                                                    | what it does                                                                                                                                                                       |
| ------------------ | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rule-editor-web`  | this repo's `Dockerfile` + [`docker/nginx.conf`](docker/nginx.conf) | nginx serves the built `dist/` and proxies `/api`, `/v3/api-docs`, `/swagger-ui*` to the rest container — the browser sees **one origin** (needed for the session cookie and CSRF) |
| `rule-editor-rest` | the rest repo's `Dockerfile`                                        | the API on `:8081` (not published); per-user git workspaces and the metadata store on volumes                                                                                      |

Both images are built from **build output**, not from sources: `dist/` here and the exploded
bundle under the rest repo's `target/`. Build first (steps 2–3), then compose (step 5).

⚠ Status: the builds and the rest bundle's start-up were verified (2026-10-06); the images and
the compose run itself were not — the sandbox they were written in has no Docker. The first
`docker compose up` is the real test.

## Prerequisites

- JDK 25 + Maven (the rest build resolves its `net.cumba` dependencies from Maven Central,
  or from a repository your `~/.m2/settings.xml` names for their snapshots).
- Node 24 + npm.
- Docker with Compose v2 (`docker compose`) — e.g. Docker Desktop with the WSL2 backend. Steps
  2–3 can run on any machine; step 5 needs the built files where Docker can see them.
- A **personal access token** on the forge that hosts the rule corpus you want to edit
  (GitHub by default: a fine-grained token with _Contents: read_ on the corpus repository,
  _read and write_ for edit mode) — the editor logs in with it.

## 1. Clone the two repositories side by side

The compose file expects the web checkout next to the rest checkout, under these names:

```bash
git clone https://github.com/cumba-oss/cumba-oss-corej-rule-editor-rest.git
git clone https://github.com/cumba-oss/cumba-oss-corej-rule-editor-web.git
```

## 2. Build the SPA → `cumba-oss-corej-rule-editor-web/dist/`

```bash
cd cumba-oss-corej-rule-editor-web
npm ci
npm run build          # or `npm run verify` to run the full gate first
cd ..
```

## 3. Build the REST bundle → `cumba-oss-corej-rule-editor-rest/target/…`

```bash
cd cumba-oss-corej-rule-editor-rest
mvn -B clean package -DskipTests     # drop -DskipTests to run the tests too
```

Result: `target/cumba-oss-corej-rule-editor-rest-0.1.0-SNAPSHOT/cumba-oss-corej-rule-editor-rest-0.1.0-SNAPSHOT/`
(the doubled directory is intended — the Dockerfile copies exactly that path). If the version
differs, pass it to compose as `VERSION=<version>`.

## 4. Configure

The defaults in `docker-compose.yml` bind the editor to the public corpus on **GitHub**:

| variable                | default                                                   |
| ----------------------- | --------------------------------------------------------- |
| `EDITOR_REPOSITORY_URL` | `https://github.com/cumba-oss/cumba-oss-corej-rules.git`  |
| `EDITOR_FORGE_TYPE`     | `github` (or `gitea`)                                     |
| `EDITOR_FORGE_API_URL`  | `https://api.github.com` (Gitea: `https://<host>/api/v1`) |
| `WEB_PORT`              | `8080` (on 127.0.0.1 only)                                |
| `JAVA_OPTS`             | `-Xmx1g`                                                  |

Override any of them in the shell or in a `.env` file next to `docker-compose.yml`, e.g.
`EDITOR_REPOSITORY_URL=https://github.com/<you>/cumba-oss-corej-rules.git` to work on a fork.
Every other key (workspace retention, CORS, cookie flags) is documented in the rest repo's
`src/main/resources/application.yaml`; set it by mounting a directory holding an
`application.yaml` at `/etc/rule-editor` in the rest service, or as an environment variable
(Spring's relaxed binding: `editor.workspace.retention-days` → `EDITOR_WORKSPACE_RETENTIONDAYS`).

⚠ **The session cookie is `Secure`** — the forge token lives in the session, so the cookie must
never cross plain HTTP (security review M3). The compose file publishes nginx on the **loopback
only** (`127.0.0.1:${WEB_PORT}`); Chrome and Firefox send a `Secure` cookie to
`http://localhost`, so a trial on the same machine works as it is. To serve other machines, put
a TLS-terminating reverse proxy in front of that port (it also sets HSTS) — plain HTTP to
anything but localhost is **not supported**. Trial opt-out only, for a throw-away instance:
`COOKIE_SECURE=false` (and edit the port binding to reach it from elsewhere) — never with real
tokens.

`EDITOR_TRUSTED_PROXIES` defaults to exactly the compose network's pinned subnet (`172.28.40.0/24`)
so the per-client limits count clients, not nginx. If that subnet collides with a host network,
change the subnet and `EDITOR_TRUSTED_PROXIES` together. A client inside a trusted block cannot be
told from a proxy, so never trust a wider range; the TLS proxy on the host must append the real
client to `X-Forwarded-For`.

## 5. Build the images and start

```bash
cd cumba-oss-corej-rule-editor-rest
docker compose up --build            # add -d to run in the background
```

Open <http://localhost:8080/>. Quick checks:

```bash
curl -s http://localhost:8080/api/info        # {"service":"corej-rule-editor-rest", … "forge":"github" …}
docker compose logs -f rule-editor-rest       # "Started RuleEditorApplication"
```

Stop with `docker compose down` — the `workspaces` and `metadata-store` volumes survive;
`docker compose down -v` deletes them (and every user's unpushed work in them).

## 6. Log in

Login name + the forge's personal access token. The token decides the mode:

| the token can…          | mode                                                                     |
| ----------------------- | ------------------------------------------------------------------------ |
| not read the repository | login refused                                                            |
| read, but not push      | `READ_ONLY` — browse, edit buffers, switch branches; no save/commit/push |
| read and push           | `EDIT`                                                                   |

Your first login clones the repository into your workspace (can take a moment). Changes go on
a branch — the default branch is read-only — and reach it through a pull request.

To exercise the whole path, do by hand what the rest repo's `src/test/smoke.sh` does: login,
Explorer, new branch, open a rule, save, commit, push, then find the commit on the forge.

## The metadata store

Analysis, completion, tooltips and scenario runs read the engine's own **metadata store**
(CDISC Library content, store format 5), which is not shipped: seed it once and put the file
into the `metadata-store` volume as `metadata-store.zip` — the rest repo's `docker-compose.yml`
header says how. Without it the editor still browses, edits, analyses and runs, with empty
scope completion and library-dependent scenarios failing with that reason.

## Troubleshooting

| symptom                                                                   | cause                                                                                                                                                     |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `COPY failed: … target/cumba-oss-corej-rule-editor-rest-…: not found`     | step 3 not run, or `VERSION` does not match the built version                                                                                             |
| `COPY failed: … dist/`                                                    | step 2 not run                                                                                                                                            |
| rest exits with `Config data location '/etc/rule-editor/' does not exist` | an image built before the Dockerfile created that directory — rebuild with `--build`                                                                      |
| login works, every later call answers `401`                               | the browser dropped the `Secure` session cookie: reach the editor over HTTPS or as `http://localhost` (`COOKIE_SECURE=false` only for a throw-away trial) |
| `401 FORGE_REFUSED` at login                                              | the token cannot read the repository (the forge answers 404 there, not 401)                                                                               |
| `502 FORGE_UNAVAILABLE`                                                   | the container cannot reach `EDITOR_FORGE_API_URL` (proxy / DNS / TLS inside Docker)                                                                       |

## Without Docker

- **Development:** run the rest app (`java -cp "target/classes:target/libs/*"
net.cumba.corej.editor.RuleEditorApplication --server.servlet.session.cookie.secure=false …`,
  see the rest README) and `npm run dev` here — Vite on `:5173` proxies `/api` to `:8081`.
- **One process:** bundle the SPA into the rest jar —
  `mvn -Pbundle-web clean package -Dweb.dist.dir=../cumba-oss-corej-rule-editor-web/dist` in the
  rest repo, then `./run.sh --server.servlet.session.cookie.secure=false` in the exploded bundle;
  the editor is at `http://localhost:8081/`.
