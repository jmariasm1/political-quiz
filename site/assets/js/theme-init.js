// Runs before the first paint, so the page never flashes the wrong theme.
(function () {
  var saved = null;
  try {
    saved = window.localStorage.getItem('gic.theme');
  } catch (e) {
    saved = null;
  }
  var dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.setAttribute('data-theme', saved === 'dark' || saved === 'light' ? saved : dark ? 'dark' : 'light');
})();
