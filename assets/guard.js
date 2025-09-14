(function(){
  function start(){
    try {
      var u = (window.Auth && Auth.getUser && Auth.getUser()) || null;
      if (!u) {
        var file = (location.pathname.split('/').pop() || 'index.html');
        var next = encodeURIComponent('./' + file);
        location.replace('./sign-in.html?next=' + next);
      }
    } catch (_) {
      // If anything goes wrong, fail closed to sign-in
      location.replace('sign-in.html');
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
