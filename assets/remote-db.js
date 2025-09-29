(function(){
  // Always use the remote Postgres API. If Config.apiBase is not set,
  // default to same-origin relative path ("/api/notes"). Resolve lazily so
  // script order does not matter.
  function base() {
    const v = (window.Config && window.Config.apiBase ? window.Config.apiBase : '');
    return String(v).replace(/\/$/, '');
  }

  function headers(json, opts) {
    const h = {};
    if (json) h['Content-Type'] = 'application/json';
    if (window.Config && Config.apiSecret) h['X-Token'] = String(Config.apiSecret);
    if (opts && opts.viewer) h['X-Viewer'] = opts.viewer;
    return h;
  }

  function currentUser() {
    try {
      if (window.Auth && typeof Auth.getUser === 'function') {
        return Auth.getUser();
      }
    } catch (_) {
      /* ignore */
    }
    return null;
  }

  async function addNote({ user, text, files }) {
    const attachments = [];
    if (files && files.length) {
      for (const f of Array.from(files)) {
        const dataUrl = await new Promise((resolve, reject) => {
          const fr = new FileReader();
          fr.onload = () => resolve(fr.result);
          fr.onerror = () => reject(fr.error);
          fr.readAsDataURL(f);
        });
        attachments.push({ name: f.name, type: f.type || 'application/octet-stream', size: f.size, dataUrl });
      }
    }
    const body = { user, text: String(text || '').trim(), attachments };
    const url = (base() || '') + '/api/notes';
    const res = await fetch(url, { method: 'POST', headers: headers(true), body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data && data.error) || 'remote-insert-failed');
    return data.note;
  }

  async function getAllNotes() {
    const url = (base() || '') + '/api/notes';
    const res = await fetch(url, { headers: headers(false) });
    if (!res.ok) throw new Error('remote-read-failed');
    const data = await res.json();
    const notes = data && data.notes ? data.notes : [];
    // Coerce types and normalize attachments for UI rendering
    for (const n of notes) {
      if (n && typeof n.timestamp === 'string') {
        const t = Number(n.timestamp);
        if (!Number.isNaN(t) && Number.isFinite(t)) n.timestamp = t;
      }
      if (n.attachments && n.attachments.length) {
        const rebuilt = [];
        for (const att of n.attachments) {
          if (att && att.dataUrl) {
            try {
              const blob = await (await fetch(att.dataUrl)).blob();
              rebuilt.push({ name: att.name, type: att.type || blob.type, size: att.size || blob.size, blob });
            } catch (_) { /* skip if fetch fails */ }
          }
        }
        n.attachments = rebuilt;
      }
    }
    return notes;
  }

  async function getLatestNoteForToday(user) {
    const arr = await getTodayNotes(user);
    return arr[0] || null;
  }

  async function getTodayNotes(user) {
    const all = await getAllNotes();
    const todayKey = Utils.toDateKey(new Date());
    const arr = all.filter(n => n.dateKey === todayKey && n.user === user);
    return arr;
  }

  async function getNotesExcludingToday() {
    const all = await getAllNotes();
    const todayKey = Utils.toDateKey(new Date());
    return all.filter(n => n.dateKey !== todayKey);
  }

  async function clearTodayNotes() {
    const url = (base() || '') + '/api/notes?scope=today';
    const res = await fetch(url, { method: 'DELETE', headers: headers(false) });
    if (!res.ok) throw new Error('remote-clear-today-failed');
    return true;
  }

  async function clearAll() {
    const url = (base() || '') + '/api/notes?scope=all';
    const res = await fetch(url, { method: 'DELETE', headers: headers(false) });
    if (!res.ok) throw new Error('remote-clear-all-failed');
    return true;
  }

  async function getPromptsForUser(user) {
    const viewer = currentUser();
    if (!viewer || viewer !== user) throw new Error('unauthorized');
    const url = (base() || '') + '/api/prompts?user=' + encodeURIComponent(user);
    const res = await fetch(url, { headers: headers(false, { viewer }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error((data && data.error) || 'prompts-read-failed');
      err.code = data && data.error;
      throw err;
    }
    const prompts = Array.isArray(data.prompts) ? data.prompts : [];
    return {
      prompts,
      editable: !!(data && data.editable),
      dateKey: data && data.dateKey,
      hasAny: !!(data && data.hasAny)
    };
  }

  async function savePromptsForUser(user, prompts) {
    const viewer = currentUser();
    if (!viewer || viewer !== user) throw new Error('unauthorized');
    const url = (base() || '') + '/api/prompts';
    const rows = Array.isArray(prompts) ? prompts : [];
    const body = { user, prompts: rows, dateKey: Utils.toDateKey(new Date()) };
    const res = await fetch(url, { method: 'POST', headers: headers(true, { viewer }), body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error((data && data.error) || 'prompts-save-failed');
      err.code = data && data.error;
      throw err;
    }
    return {
      prompts: Array.isArray(data.prompts) ? data.prompts : [],
      dateKey: data.dateKey
    };
  }

  async function clearPrompts(scope, user) {
    const params = new URLSearchParams();
    const mode = (scope || 'all').toLowerCase();
    params.set('scope', mode);
    if (mode === 'user' && user) params.set('user', user);
    const url = (base() || '') + '/api/prompts?' + params.toString();
    const res = await fetch(url, { method: 'DELETE', headers: headers(false) });
    if (!res.ok) throw new Error('prompts-clear-failed');
    return true;
  }

  async function getDailyPrompt(user) {
    const viewer = currentUser();
    if (!viewer || viewer !== user) throw new Error('unauthorized');
    const url = (base() || '') + '/api/prompt-answers?user=' + encodeURIComponent(user);
    const res = await fetch(url, { headers: headers(false, { viewer }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error((data && data.error) || 'daily-prompt-failed');
      err.code = data && data.error;
      throw err;
    }
    return data;
  }

  async function savePromptAnswer(user, answerText) {
    const viewer = currentUser();
    if (!viewer || viewer !== user) throw new Error('unauthorized');
    const url = (base() || '') + '/api/prompt-answers';
    const body = { user, answerText }; // include viewer date server side
    const res = await fetch(url, { method: 'POST', headers: headers(true, { viewer }), body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error((data && data.error) || 'prompt-answer-save-failed');
      err.code = data && data.error;
      throw err;
    }
    return data;
  }

  async function clearPromptAnswers(scope, user) {
    const params = new URLSearchParams();
    const mode = (scope || 'all').toLowerCase();
    params.set('scope', mode);
    if (mode === 'user' && user) params.set('user', user);
    const url = (base() || '') + '/api/prompt-answers?' + params.toString();
    const res = await fetch(url, { method: 'DELETE', headers: headers(false) });
    if (!res.ok) throw new Error('prompt-answers-clear-failed');
    return true;
  }

  async function getRevealAnswers(user) {
    const viewer = currentUser();
    if (!viewer || viewer !== user) throw new Error('unauthorized');
    const params = new URLSearchParams();
    params.set('user', user);
    params.set('mode', 'reveal');
    const url = (base() || '') + '/api/prompt-answers?' + params.toString();
    const res = await fetch(url, { headers: headers(false, { viewer }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error((data && data.error) || 'prompt-reveal-failed');
      err.code = data && data.error;
      throw err;
    }
    return data;
  }

  window.DB = {
    addNote,
    getAllNotes,
    getLatestNoteForToday,
    getTodayNotes,
    getNotesExcludingToday,
    clearTodayNotes,
    clearAll,
    getPromptsForUser,
    savePromptsForUser,
    clearPrompts,
    getDailyPrompt,
    savePromptAnswer,
    clearPromptAnswers,
    getRevealAnswers
  };
})();
