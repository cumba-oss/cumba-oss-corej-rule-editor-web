# syntax=docker/dockerfile:1
# The rule editor SPA as an nginx container (PLAN-rule-editor §4.2 shape 2, RE-Q6):
# serves the built SPA and proxies /api (and the OpenAPI paths) to the rest
# container, so the browser sees ONE origin — session cookie + CSRF need no cross-site
# handling. docker-compose.yml in cumba-oss-corej-rule-editor-rest wires the pair.
#
# Built FROM THE SOURCES, in two stages, so `docker compose up --build` (or `docker build`)
# needs nothing built beforehand and can never serve a stale dist/:
#
#   build    Node runs `npm ci && npm run build` (vite; the brand plugin writes dist/brands/**);
#   runtime  nginx with the template, the brand check and that dist/.
#
#     docker build -t rule-editor-web .
#
# The gate (`npm run verify`) is not run here — it is this repo's CI. The npm cache is a build
# cache mount, so a rebuild only downloads what the lock file changed.
#
# The upstream name `rule-editor-rest` is the compose service; override it with
# --build-arg API_UPSTREAM=host:port, or API_UPSTREAM in the container's environment.
#
# The brand (PLAN-web-branding-and-theme): BRAND=<name> in the container's environment selects
# the folder under /usr/share/nginx/html/brands/ that nginx serves as /brand/ (default neutral;
# p300 ships too; mount your own at brands/<name> — DOCKER.md). docker/25-cumba-brand.sh refuses
# to start on an unknown name, naming the available ones.
#
# ⚠ The sandbox this was written in has no container runtime: the build stage's commands were
# run outside a container on a source export, the image build itself is verified on the
# owner's host.
# node:24-slim, not -alpine: the lock file is resolved on glibc, and vite's native bindings
# (rolldown) are platform packages.
ARG NODE_IMAGE=node:24-slim
ARG NGINX_IMAGE=nginx:1.27-alpine

FROM ${NODE_IMAGE} AS build
WORKDIR /src
# The manifests first: `npm ci` is a layer of its own, re-run only when they change.
COPY package.json package-lock.json .npmrc ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM ${NGINX_IMAGE}

ARG API_UPSTREAM=rule-editor-rest:8081
COPY docker/nginx.conf /etc/nginx/templates/default.conf.template
# The official image renders /etc/nginx/templates/*.template with envsubst at start-up,
# substituting only the variables named in NGINX_ENVSUBST_FILTER (so nginx's own $vars
# survive).
ENV API_UPSTREAM=${API_UPSTREAM} \
    BRAND=neutral \
    NGINX_ENVSUBST_FILTER="API_UPSTREAM|BRAND"
# ⚠ --chmod=0755 is load-bearing: the entrypoint IGNORES a non-executable script ("Ignoring … not
# executable"), and an unchecked unknown BRAND would then 404 /brand/brand.css and render the
# defaults with no error.
COPY --chmod=0755 docker/25-cumba-brand.sh /docker-entrypoint.d/25-cumba-brand.sh
COPY --from=build /src/dist/ /usr/share/nginx/html/
EXPOSE 80
