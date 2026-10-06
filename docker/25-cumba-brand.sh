#!/bin/sh
# Refuses to start nginx with a BRAND that is not a brand (PLAN-web-branding-and-theme §5.5): the
# official image runs /docker-entrypoint.d/*.sh before nginx, and a non-zero exit stops the
# container — a typo must not silently serve the default look. Checks the name rule before the
# name touches a path, then that brands/<name>/brand.css exists under the html root. Lists the
# available brands on refusal. CUMBA_HTML_ROOT is for the test (docker/brand-entrypoint.test.ts).
#
# ⚠ The entrypoint IGNORES a script that is not executable: the Dockerfile copies this file with
# --chmod=0755, and it is committed with mode 755.
set -e

root="${CUMBA_HTML_ROOT:-/usr/share/nginx/html}"

available() {
    for css in "$root"/brands/*/brand.css; do
        [ -f "$css" ] || continue
        dir=$(dirname "$css")
        basename "$dir"
    done | tr '\n' ' '
}

# ${BRAND-neutral}, not ${BRAND:-neutral}: an EMPTY variable must be refused, because envsubst
# renders the alias as brands// and every /brand/ request 404s silently.
brand="${BRAND-neutral}"

if [ -z "$brand" ]; then
    echo "cumba brand: BRAND is set but empty — unset it for neutral, or name a brand; available: $(available)" >&2
    exit 1
fi

if ! printf '%s' "$brand" | grep -Eq '^[a-z0-9][a-z0-9-]{0,39}$'; then
    echo "cumba brand: BRAND=\"$brand\" is not a brand name (^[a-z0-9][a-z0-9-]{0,39}$); available: $(available)" >&2
    exit 1
fi

if [ ! -f "$root/brands/$brand/brand.css" ]; then
    echo "cumba brand: BRAND=\"$brand\" has no $root/brands/$brand/brand.css; available: $(available)" >&2
    exit 1
fi

echo "cumba brand: serving /brand/ from brands/$brand"
