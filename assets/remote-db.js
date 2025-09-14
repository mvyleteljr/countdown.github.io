(function(){
  // Always use the remote Postgres API. If Config.apiBase is not set,
  // default to same-origin relative path ("/api/notes"). Resolve lazily so
  // script order does not matter.
  function base() {
    const v = (window.Config && window.Config.apiBase ? window.Config.apiBase : '');
    return String(v).replace(/\/$/, '');
  }

  function headers(json) {
    const h = {};
    if (json) h['Content-Type'] = 'application/json';
    if (window.Config && Config.apiSecret) h['X-Token'] = String(Config.apiSecret);
    return h;
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

  window.DB = { addNote, getAllNotes, getLatestNoteForToday, getTodayNotes, getNotesExcludingToday, clearTodayNotes, clearAll };
})();
