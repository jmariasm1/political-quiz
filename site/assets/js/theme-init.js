// Runs before the first paint, so the page never flashes the wrong theme.
// Light is the default. Dark appears only for someone who chose it with the switch.
(function () {
  var saved = null;
  try {
    saved = window.localStorage.getItem('gic.theme');
  } catch (e) {
    saved = null;
  }
  var dark = saved === 'dark';
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  document.querySelector('meta[name="theme-color"]').setAttribute('content', dark ? '#161616' : '#ffffff');
})();
