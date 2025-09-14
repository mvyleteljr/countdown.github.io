// Logic for log.html: list previous days' notes with exact timestamps
(function(){
  function el(id) { return document.getElementById(id); }

  function renderNote(note) {
    const card = document.createElement('div');
    card.className = 'note-card';
    const when = new Date(note.timestamp);

    const meta = document.createElement('div');
    meta.className = 'note-meta';
    meta.textContent = `${note.user || 'Unknown'} — ${Utils.formatDateTime(when)}`;
    card.appendChild(meta);

    if (note.text) {
      const text = document.createElement('div');
      text.textContent = note.text;
      card.appendChild(text);
    }

    if (note.attachments && note.attachments.length) {
      const wrap = document.createElement('div');
      wrap.className = 'attachments';
      for (const att of note.attachments) {
        if (att.type.startsWith('image/')) {
          const img = document.createElement('img');
          img.alt = att.name;
          img.src = URL.createObjectURL(att.blob);
          wrap.appendChild(img);
        } else if (att.type.startsWith('video/')) {
          const vid = document.createElement('video');
          vid.controls = true;
          vid.src = URL.createObjectURL(att.blob);
          wrap.appendChild(vid);
        } else {
          const a = document.createElement('a');
          a.className = 'download';
          a.href = URL.createObjectURL(att.blob);
          a.download = att.name || 'attachment';
          a.textContent = `Download ${att.name || att.type}`;
          wrap.appendChild(a);
        }
      }
      card.appendChild(wrap);
    }
    return card;
  }

  async function refreshLog() {
    const container = el('logList');
    container.innerHTML = '';
    const notes = await DB.getNotesExcludingToday();
    if (!notes.length) {
      const p = document.createElement('p');
      p.className = 'muted';
      p.textContent = 'No previous notes yet.';
      container.appendChild(p);
      return;
    }

    // Group by dateKey for clarity
    const groups = new Map();
    for (const n of notes) {
      const k = n.dateKey;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(n);
    }

    const sortedKeys = Array.from(groups.keys()).sort().reverse();
    for (const k of sortedKeys) {
      const h = document.createElement('h3');
      h.textContent = k;
      container.appendChild(h);
      const dayNotes = groups.get(k);
      // Sort by time desc already; optionally group by user
      for (const n of dayNotes) container.appendChild(renderNote(n));
    }
  }

  async function start() { refreshLog(); }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
