// Sends visitors from the site root to their language: their saved choice first, then the browser's.
(function () {
  var choice = null;
  try {
    choice = window.localStorage.getItem('gic.lang');
  } catch (e) {
    choice = null;
  }
  if (choice !== 'en' && choice !== 'es') {
    var languages = navigator.languages || [navigator.language || 'en'];
    choice = /^es\b/i.test(languages[0] || '') ? 'es' : 'en';
  }
  window.location.replace('./' + choice + '/' + window.location.hash);
})();
