# Running the rule editor with Docker — step by step

The rule editor is two apps: `cumba-oss-corej-rule-editor-rest` (the API, Java) and this SPA
(`cumba-oss-corej-rule-editor-web`). `docker-compose.yml` in the **rest** repo runs them as
two containers:

| container          | image built from                                                    | what it does                                                                                                                                                                       |
| ------------------ | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rule-editor-web`  | this repo's `Dockerfile` + [`docker/nginx.conf`](docker/nginx.conf) | nginx serves the built `dist/` and proxies `/api`, `/v3/api-docs`, `/swagger-ui*` to the rest container — the browser sees **one origin** (needed for the session cookie and CSRF) |
| `rule-editor-rest` | the rest repo's `Dockerfile`                                        | the API on `:8081` (not published); per-user git workspaces and the metadata store on volumes                                                                                      |

Both images are built **from the sources** (multi-stage Dockerfiles: Node runs the SPA build, Maven
the rest build, inside the image build). After every `git pull`, `docker compose up --build` is the
whole build — there is no `dist/` or `target/` to build beforehand, and none that can be stale.

Status: first real container run 2026-10-06 — rootless Podman in WSL2, as the pod of step 5b;
compose on the same host since 2026-10-08 (netavark switched to iptables, step 5b). Every trap
found is in the troubleshooting table.

## Prerequisites

- For a build of `main` between releases only: a `~/.m2/settings.xml` naming a Maven repository
  that serves the `cumba-oss-*` development snapshots (step 2) — a release builds from Maven
  Central with no settings at all. No JDK, Maven or Node is needed on the host to run the editor
  — only to develop it.
- Docker with Compose v2 (`docker compose`) — e.g. Docker Desktop with the WSL2 backend — or
  rootless Podman with `podman-compose` (steps 5b, 5c).
- A **personal access token** on the forge that hosts the rule corpus you want to edit
  (GitHub by default: a fine-grained token with _Contents: read_ on the corpus repository,
  _read and write_ for edit mode) — the editor logs in with it.

## 1. Clone the two repositories side by side

The compose file expects the web checkout next to the rest checkout, under these names:

```bash
git clone https://github.com/cumba-oss/cumba-oss-corej-rule-editor-rest.git
git clone https://github.com/cumba-oss/cumba-oss-corej-rule-editor-web.git
```

## 2. Where the rest build's dependencies come from

The rest image runs Maven inside its build. With no settings it resolves from **Maven Central**,
which holds every third-party dependency and every **released** `cumba-oss-*` artifact — so a
release of the rest repo builds with nothing passed. Central hosts **no snapshots**, and between
releases `main` pins the `cumba-oss-*` development snapshots (the rest repo's root pom,
`dependency.cumba-oss-*.version`): built with no settings, `main` stops at the first of them
(`Could not find artifact net.cumba:cumba-oss-bootstrap:jar:<version>-SNAPSHOT`). Those snapshots
are published to the project's own snapshot repository, not to Central; to build `main` you need a
Maven `settings.xml` naming a repository that serves them, given to the Maven step as the
**optional build secret** `maven_settings` — mounted for that step only, never stored in an image
layer. Add it with a `docker-compose.override.yml` next to the rest repo's `docker-compose.yml`
(compose merges it in by itself) — never copy the settings into the repo:

```yaml
services:
  rule-editor-rest:
    build:
      secrets:
        - maven_settings
secrets:
  maven_settings:
    file: ${HOME}/.m2/settings.xml
```

Without such a repository, run `main` without Docker instead: `mvn install` the `cumba-oss-*`
chain bottom-up (commons, formats, datatable, corej), then the rest repo ("Without Docker" below).

The first build downloads the dependencies into a build cache (several minutes); later builds
only fetch what changed. The SPA's build needs no credentials (public npm registry).

## 3. Nothing to build beforehand

Earlier versions of this guide built `dist/` and `target/` on the host first and the images copied
them — a stale one was packaged silently. The images now build from the sources; `npm run build`,
`npm run verify` and `mvn package` on the host are for development and the gates only. The tests
are not run in the image build — they are each repo's CI.

⚠ **One exception: an upstream fix.** On `main` the rest image pulls the `cumba-oss-*` engine,
commons and datatable as development snapshots, and its Maven step re-runs only when the rest
repo's sources change. After a fix published only upstream (a new engine snapshot), the step is
cached and the image keeps the old engine — rebuild that stage without the layer cache:

```bash
docker compose build --no-cache rule-editor-rest && docker compose up -d     # Podman: podman-compose …
```

The deployment shape with the SPA **bundled into the rest jar** (one container) is not built by
these Dockerfiles; build that bundle on the host (`mvn -Pbundle-web …`, "Without Docker" below).

## 4. Configure

The defaults in `docker-compose.yml` bind the editor to the public corpus on **GitHub**:

| variable                    | default                                                        |
| --------------------------- | -------------------------------------------------------------- |
| `EDITOR_REPOSITORY_URL`     | `https://github.com/cumba-oss/cumba-oss-corej-rules.git`       |
| `EDITOR_FORGE_TYPE`         | `github` (or `gitea`)                                          |
| `EDITOR_FORGE_API_URL`      | `https://api.github.com` (Gitea: `https://<host>/api/v1`)      |
| `WEB_PORT`                  | `8080` (on 127.0.0.1 only)                                     |
| `JAVA_OPTS`                 | `-Xmx1g`                                                       |
| `EDITOR_STORE_SEED_TYPE`    | `GITHUB_PKL` — or `API`, or `NONE` (the metadata store, below) |
| `EDITOR_STORE_SEED_PKL_TAG` | `v0.17.1` — a tag of `github.com/cdisc-org/cdisc-rules-engine` |
| `EDITOR_STORE_SEED_API_KEY` | empty — your CDISC Library API key, for `API` only             |

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

### The brand

`BRAND=<name>` in the environment of `rule-editor-web` selects the look (`neutral` by default,
`p300` ships too; `docker-compose.yml` passes `${BRAND:-neutral}` through, so `BRAND=p300 docker
compose up` is enough). An unknown name stops the container at start-up with the available names
in its log — the look is never silently the default. To add a brand of your own, mount its folder
(the token contract: `brands/README.md`) beside the shipped ones:

```yaml
volumes:
  - ./my-brands/acme:/usr/share/nginx/html/brands/acme:ro
```

and set `BRAND=acme`. The equivalent for `docker run`:
`-e BRAND=acme -v ./my-brands/acme:/usr/share/nginx/html/brands/acme:ro`.

## 5. Build the images and start

```bash
cd cumba-oss-corej-rule-editor-rest
docker compose up --build            # add -d to run in the background; Podman: podman-compose up --build
# after a git pull on Podman: podman-compose down first — `up --build` alone can keep the old containers
```

Open <http://127.0.0.1:8080/> (on WSL2 `localhost` fails — step 5c). Quick checks:

```bash
curl -s http://127.0.0.1:8080/api/info        # {"service":"corej-rule-editor-rest", … "forge":"github" …}
docker compose logs -f rule-editor-rest       # "Started RuleEditorApplication"
```

Stop with `docker compose down` — the `workspaces` and `metadata-store` volumes survive;
`docker compose down -v` deletes them (and every user's unpushed work in them).

## 5b. Rootless Podman without compose — one pod

`podman-compose` creates a bridge network, and on hosts whose kernel lacks parts of nftables
(seen on WSL2) netavark then fails with `"nft" did not return successfully while applying ruleset`.
A **pod** needs no bridge network: its containers share one network namespace and reach each other
on `127.0.0.1`, and rootless port publishing goes through pasta. Build the images from **each
repo's own directory** (`.` in the wrong directory builds the rest image under the web tag):

```bash
cd cumba-oss-corej-rule-editor-rest
podman build -t rule-editor-rest .   # main between releases: add --secret id=maven_settings,src=$HOME/.m2/settings.xml (step 2)
podman build -t rule-editor-web ../cumba-oss-corej-rule-editor-web

podman pod create --name rule-editor -p 127.0.0.1:8080:80

podman run -d --pod rule-editor --name rule-editor-rest \
  -e EDITOR_REPOSITORY_URL=https://github.com/cumba-oss/cumba-oss-corej-rules.git \
  -e EDITOR_FORGE_TYPE=github \
  -e EDITOR_FORGE_API_URL=https://api.github.com \
  -e EDITOR_WORKSPACE_ROOT=/var/lib/rule-editor/workspaces \
  -e CDISC_METADATA_STORE=/var/lib/rule-editor/metadata-store/metadata-store.zip \
  -e EDITOR_TRUSTED_PROXIES=127.0.0.1/32 \
  -e JAVA_OPTS=-Xmx1g \
  -v rule-editor-workspaces:/var/lib/rule-editor/workspaces \
  -v rule-editor-metadata-store:/var/lib/rule-editor/metadata-store \
  rule-editor-rest

podman run -d --pod rule-editor --name rule-editor-web \
  -e API_UPSTREAM=127.0.0.1:8081 -e BRAND=neutral \
  rule-editor-web

podman logs rule-editor-rest | grep Started              # "Started RuleEditorApplication"
curl -s http://127.0.0.1:8080/api/info
```

- `API_UPSTREAM=127.0.0.1:8081`, not `localhost`: in the pod nginx reaches the rest app over the
  shared loopback, and pinning IPv4 keeps it matching `EDITOR_TRUSTED_PROXIES=127.0.0.1/32` (the
  compose file's pinned subnet does not exist in a pod).
- After a rebuild, replace only the container that changed:
  `podman rm -f rule-editor-web && podman run … rule-editor-web` (the pod and the rest container
  stay up). Stop everything with `podman pod stop rule-editor`, remove it with
  `podman pod rm -f rule-editor`; the named volumes survive both.
- Alternative that keeps compose (used since 2026-10-08): switch netavark to iptables —
  `~/.config/containers/containers.conf`: `[network]` `firewall_driver = "iptables"`, the
  `iptables` package installed — then `podman-compose down`, remove the half-created network
  (`podman network ls`, `podman network rm …`) and `podman-compose up --build` again.

## 5c. WSL2 and Windows

- **Use `http://127.0.0.1:8080/`, not `localhost`** — inside WSL and from the Windows browser
  alike. `localhost` resolves to `::1` first, and the rootless port forwarding resets the IPv6
  connection (`curl: Recv failure: Connection reset by peer`); browsers do not fall back to IPv4
  after a reset. Stay on one host name: the session cookie belongs to the exact host you logged
  in on.
- `127.0.0.1` is a secure context for Chrome and Firefox, so the `Secure` session cookie works.
  Reaching WSL by its own address (`hostname -I`, `http://172.x.x.x:8080/`) is plain HTTP to a
  non-local host: the cookie is dropped (every call after the login answers `401`) — use
  `127.0.0.1`, or for a throw-away trial only `-e SERVER_SERVLET_SESSION_COOKIE_SECURE=false` on
  the rest container plus a pod published on that address.
- With WSL's mirrored networking (`networkingMode=mirrored` in `.wslconfig`) the Hyper-V firewall
  can block the port from Windows; allow it with `New-NetFirewallHyperVRule` (elevated PowerShell).

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

**Token scopes on Gitea** (when you bind the editor to a Gitea forge): **`read:user`** +
**`read:repository`** to log in (`READ_ONLY`), plus **`write:repository`** for `EDIT`. A token
with repository scopes only fails the editor's first login probe (`GET /user`) with
`FORGE_REFUSED`. A token never grants more than its account has.

## The metadata store — seeded on the first start

Analysis, completion of variables and Scope values, the library tooltips and scenario runs read
the CDISC Library content from the engine's own **metadata store** (store format 5) in the
`metadata-store` volume. The rest container seeds it itself, in the background, when the volume
holds none:

- `GITHUB_PKL` (default): from the CDISC rules engine's published cache at the tag
  `EDITOR_STORE_SEED_PKL_TAG` — one download of about 80 MB, about half a minute depending on
  the connection (measured: 26 s for the whole first seed); the store is about 4.5 MB. `API`: from the CDISC Library API with `EDITOR_STORE_SEED_API_KEY` — several
  minutes (about 860 requests). `NONE`: no seeding (mount a store of your own).
- The editor answers at once. While seeding, it shows _"No metadata store on this instance
  (metadata store is being seeded (GITHUB_PKL v0.17.1)…) … Metadata store seed: seeding
  (GITHUB_PKL v0.17.1)…"_ and clears the notice by itself when the store opens; a failure shows
  _"metadata store seeding failed (…): reason"_ and the editor keeps running without a store
  (it still browses, edits, analyses and runs, with empty scope completion and
  library-dependent scenarios failing with that reason).
- The store remembers its source (`metadata-store.zip.seed.json` beside it): change the type or
  the tag and restart, and it is re-seeded — the old store serves until the new one is ready,
  and the notice shows the re-seed (_"Metadata store seed: seeding (GITHUB_PKL v0.18.0)…"_). A
  failed or incomplete re-seed stays visible in the notice while the old store serves on
  (_"Metadata store seed: seed failed (GITHUB_PKL v0.18.0): reason"_, _"… incomplete (…): …"_).
  To force a re-seed, delete `metadata-store.zip` from the volume and restart.
- A store you put into the volume yourself (no `.seed.json` beside it, at the engine's store format 5) is never touched; one in an older format is re-seeded, one from a newer engine never.
- The API key is read by the seeder only — never logged, never served, never used by a
  validation run. The store is the only CDISC Library source the editor evaluates against.

## Troubleshooting

| symptom                                                                   | cause                                                                                                                                                     |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Could not find artifact net.cumba:cumba-oss-…:<version>-SNAPSHOT`        | a build of `main` with no repository serving the `cumba-oss-*` development snapshots — pass the `maven_settings` secret, or build a release (step 2)      |
| `cumba brand: BRAND="neutral" has no …/brand.css; available:` (empty)     | an image whose SPA predates the brand kit — rebuild with `--build`                                                                                        |
| rest exits with `Config data location '/etc/rule-editor/' does not exist` | an image built before the Dockerfile created that directory — rebuild with `--build`                                                                      |
| login works, every later call answers `401`                               | the browser dropped the `Secure` session cookie: reach the editor over HTTPS or as `http://localhost` (`COOKIE_SECURE=false` only for a throw-away trial) |
| `401 FORGE_REFUSED` at login                                              | the token cannot read the repository (the forge answers 404 there, not 401)                                                                               |
| `502 FORGE_UNAVAILABLE`                                                   | the container cannot reach `EDITOR_FORGE_API_URL` (proxy / DNS / TLS inside Docker)                                                                       |
| a change does not show after `podman-compose up --build`                  | podman-compose rebuilt the images but kept the RUNNING containers on the old ones — `podman-compose down`, then `up --build`; reload with Ctrl+Shift+R    |
| `"nft" did not return successfully while applying ruleset` (podman)       | netavark cannot program nftables on this kernel (WSL2) — run the pod of step 5b, or switch netavark to iptables                                           |
| `curl: Recv failure: Connection reset by peer` on `localhost:8080`        | IPv6 (`::1`) through the rootless port forwarding — use `127.0.0.1` (step 5c)                                                                             |
| `Login refused` / `Request failed (403)`, body `Invalid CORS request`     | the proxy forwarded `Host` without the port: an nginx image older than `proxy_set_header Host $http_host` — rebuild it; any own proxy must keep the port  |
| `rule-editor-web` logs a Spring banner and `Port 8081 was already in use` | the web image was built from the rest directory (`podman build -t rule-editor-web .` in the wrong place) — build it from the web repo                     |
| `FORGE_REFUSED` although the token clones fine                            | the token lacks `read:user` (Gitea) — the login probes `GET /user` first (step 6)                                                                         |

## Without Docker

- **Development:** run the rest app (`java -cp "target/classes:target/libs/*"
net.cumba.corej.editor.RuleEditorApplication --server.servlet.session.cookie.secure=false …`,
  see the rest README) and `npm run dev` here — Vite on `:5173` proxies `/api` to `:8081`.
- **One process:** bundle the SPA into the rest jar —
  `mvn -Pbundle-web clean package -Dweb.dist.dir=../cumba-oss-corej-rule-editor-web/dist` in the
  rest repo, then `./run.sh --server.servlet.session.cookie.secure=false` in the exploded bundle;
  the editor is at `http://localhost:8081/`.
