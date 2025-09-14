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
      var ok = false;
      if (window.Auth && Auth.login) {
        ok = Auth.login(u, p);
      } else {
        // Fallback if auth.js failed to load
        var USERS = { 'Marshall': 'marsh-123', 'Isobel': 'iso-123' };
        if (USERS.hasOwnProperty(u) && String(p).trim() === USERS[u]) {
          try { localStorage.setItem('auth.user', u); } catch(_){}
          ok = true;
        }
      }
      if (ok) {
        var next = getNext();
        var target = new URL(next, location.href).toString();
        status.innerHTML = 'Signed in! Redirecting… <a id="redirectLink" class="download" href="' + target + '">Continue</a>';
        setTimeout(function(){
          try { window.location.replace(target); }
          catch(_) { try { window.location.href = target; } catch(_){} }
        }, 100);
      } else {
        status.textContent = (window.Auth ? 'Invalid password. Please try again.' : 'Auth not loaded; using fallback. Invalid credentials.');
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
