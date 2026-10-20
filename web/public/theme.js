/* Sets the colour theme before the page is painted, so there is no flash of the wrong theme.
   It is a separate file because the site's Content Security Policy does not allow inline scripts.
   Keep the two colours in step with the --paper values in src/styles/main.css and with src/lib/theme.ts. */
(function () {
  var theme = "light";
  try {
    var saved = localStorage.getItem("regis.theme");
    theme = saved === "dark" || saved === "light" ? saved : (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  } catch (e) { /* storage blocked: follow the light default */ }
  document.documentElement.setAttribute("data-theme", theme);
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", theme === "dark" ? "#0F1A15" : "#F5F1E8");
})();
