// Sets the colour scheme on <html> before the first paint, so a dark-mode user never sees a light
// flash: the manual choice Mantine's colour-scheme manager stores under "cumba-theme" ("light" /
// "dark"; "auto" or nothing = follow the OS), else the OS preference. An external file, not an
// inline script, because the nginx image's Content-Security-Policy is `script-src 'self'`. The
// same key is read by MantineProvider (src/main.tsx), so both agree. Storage access can throw (a
// blocked third-party context, a private window): any failure falls back to the OS preference.
(function () {
  var scheme = null;
  try {
    var stored = window.localStorage.getItem("cumba-theme");
    if (stored === "light" || stored === "dark") scheme = stored;
  } catch {
    scheme = null;
  }
  if (scheme === null) {
    try {
      scheme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    } catch {
      scheme = "light";
    }
  }
  document.documentElement.setAttribute("data-mantine-color-scheme", scheme);
})();
