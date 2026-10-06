# The rule editor SPA as an nginx container (PLAN-rule-editor §4.2 shape 2, RE-Q6):
# serves the BUILT dist/ and proxies /api (and the OpenAPI paths) to the rest
# container, so the browser sees ONE origin — session cookie + CSRF need no cross-site
# handling. docker-compose.yml in cumba-oss-corej-rule-editor-rest wires the pair.
#
# Built from the BUILT SPA, not from the sources: run `npm ci && npm run build` (or
# `mvn verify`, which also gates) first, then
#
#     docker build -t rule-editor-web .
#
# The upstream name `rule-editor-rest` is the compose service; override it with
# --build-arg API_UPSTREAM=host:port for another deployment.
#
# The brand (PLAN-web-branding-and-theme): BRAND=<name> in the container's environment selects
# the folder under /usr/share/nginx/html/brands/ that nginx serves as /brand/ (default neutral;
# p300 ships too; mount your own at brands/<name> — DOCKER.md). docker/25-cumba-brand.sh refuses
# to start on an unknown name, naming the available ones.
#
# ⚠ Written in a sandbox WITHOUT docker: checked for shape, not by a build.
ARG NGINX_IMAGE=nginx:1.27-alpine
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
COPY dist/ /usr/share/nginx/html/
EXPOSE 80
