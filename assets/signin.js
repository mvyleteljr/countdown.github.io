(function(){
  function getNext() {
    try {
      var p = new URLSearchParams(location.search);
      var n = p.get('next');
      return n || 'index.html';
    } catch(_) { return 'index.html'; }
  }

  function doLogin(){
    var status = document.getElementById('signinStatus');
    try {
      var u = document.getElementById('username').value;
      var p = document.getElementById('password').value;
      var ok = (window.Auth && Auth.login && Auth.login(u, p)) || false;
      if (ok) {
        status.textContent = 'Signed in! Redirecting…';
        var next = getNext();
        setTimeout(function(){ window.location.href = next; }, 150);
      } else {
        status.textContent = 'Invalid password. Please try again.';
      }
    } catch (e) {
      status.textContent = 'Sign-in failed.';
    }
  }

  function init(){
    // If already signed in, redirect immediately
    try {
      var u = (window.Auth && Auth.getUser && Auth.getUser()) || null;
      if (u) {
        var next = getNext();
        window.location.replace(next);
        return;
      }
    } catch(_){}

    var form = document.getElementById('signinForm');
    var btn = document.getElementById('signinBtn');
    if (form) form.addEventListener('submit', function(e){ e.preventDefault(); doLogin(); });
    if (btn) btn.addEventListener('click', function(){ doLogin(); });
    window.SigninPage = { login: doLogin };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

