// Minimal client-side auth for two users. Update passwords here.
const Auth = (function(){
  const STORAGE_KEY = 'auth.user';
  const USERS = {
    'Marshall': 'marsh-123',
    'Isobel': 'iso-123'
  };

  function getUser() {
    return localStorage.getItem(STORAGE_KEY);
  }

  function isValidUser(u) { return Object.prototype.hasOwnProperty.call(USERS, u); }

  function login(username, password) {
    if (!isValidUser(username)) return false;
    const ok = USERS[username] === String(password).trim();
    if (ok) localStorage.setItem(STORAGE_KEY, username);
    return ok;
  }

  function logout() { localStorage.removeItem(STORAGE_KEY); }

  function renderHeaderStatus() {
    const el = document.getElementById('userStatus');
    if (!el) return;
    const u = getUser();
    el.innerHTML = '';
    if (u) {
      const span = document.createElement('span');
      span.textContent = `Signed in as ${u}`;
      const sep = document.createElement('span'); sep.textContent = ' • ';
      const a = document.createElement('a'); a.href = '#'; a.textContent = 'Sign out';
      a.addEventListener('click', (e) => {
        e.preventDefault();
        logout();
        // Update header and notify listeners without reloading
        try { renderHeaderStatus(); } catch (_) {}
        try { window.dispatchEvent(new Event('auth-changed')); } catch (_) {}
      });
      el.append(span, sep, a);
    } else {
      const a = document.createElement('a');
      a.href = './sign-in.html';
      a.textContent = 'Sign in';
      el.appendChild(a);
    }
  }

  // Render on load if header is present
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderHeaderStatus);
  } else {
    renderHeaderStatus();
  }

  return { getUser, login, logout, isValidUser };
})();

// Ensure global visibility for other scripts that check window.Auth
try { window.Auth = Auth; } catch (_) {}
