// Logic for index.html: today's note capture and display for two users
(function(){
  function el(id) { return document.getElementById(id); }
  const USERS = ['Marshall', 'Isobel'];

  function renderNote(container, note) {
    container.innerHTML = '';
    if (!note) {
      const p = document.createElement('p');
      p.className = 'muted';
      p.textContent = "No note saved yet today.";
      container.appendChild(p);
      return;
    }

    const card = document.createElement('div');
    card.className = 'note-card';

    const when = new Date(note.timestamp);
    const meta = document.createElement('div');
    meta.className = 'note-meta';
    meta.textContent = `Saved at ${Utils.formatDateTime(when)}`;
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

    container.appendChild(card);
  }

  async function refreshTodayFor(user) {
    try {
      const notes = await DB.getTodayNotes(user);
      const latest = notes && notes.length ? notes[0] : null;
      renderNote(el(`todayNote-${user}`), latest);
      renderHistory(el(`todayHistory-${user}`), notes ? notes.slice(1) : []);
      updateEditorState(user, latest, notes ? notes.length : 0);
    } catch (e) {
      const msg = el(`noteMessage-${user}`);
      msg.textContent = 'Storage unavailable. Notes will not persist in this browser.';
      renderHistory(el(`todayHistory-${user}`), []);
      updateEditorState(user, null, 0);
    }
  }

  function renderHistory(container, notes) {
    if (!container) return;
    container.innerHTML = '';
    if (!notes || !notes.length) return;
    const label = document.createElement('div');
    label.className = 'note-meta';
    label.textContent = 'Edits today';
    container.appendChild(label);
    for (const n of notes) {
      const card = document.createElement('div');
      card.className = 'note-card';
      const when = new Date(n.timestamp);
      const meta = document.createElement('div');
      meta.className = 'note-meta';
      meta.textContent = `Edited at ${Utils.formatDateTime(when)}`;
      card.appendChild(meta);
      if (n.text) {
        const text = document.createElement('div');
        text.textContent = n.text;
        card.appendChild(text);
      }
      if (n.attachments && n.attachments.length) {
        const wrap = document.createElement('div');
        wrap.className = 'attachments';
        for (const att of n.attachments) {
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
      container.appendChild(card);
    }
  }

  function onSubmitFactory(user) {
    return async function(e) {
      if (e) { try { e.preventDefault(); } catch(_){} }
      const current = Auth.getUser();
      const status = el(`saveStatus-${user}`);
      if (!current) {
        status.textContent = 'Please sign in first.';
        return;
      }
      if (current !== user) {
        status.textContent = `You are signed in as ${current}. Only ${user} can post here.`;
        return;
      }
      status.textContent = 'Saving…';
      try {
        const text = el(`noteText-${user}`).value;
        const files = el(`noteFiles-${user}`).files;
        await DB.addNote({ user, text, files });
        // Keep text; clear attachments input only
        el(`noteFiles-${user}`).value = '';
        status.textContent = 'Saved!';
        await refreshTodayFor(user);
        setTimeout(() => status.textContent = '', 2000);
      } catch (err) {
        console.error(err);
        if (String(err && err.message) === 'edit-limit-reached') {
          status.textContent = "You've already used your one edit for today.";
          await refreshTodayFor(user);
        } else {
          status.textContent = 'Failed to save note: ' + (err && err.message || 'unknown error');
        }
      }
    }
  }

  function updateEditorState(user, note, countForToday) {
    const current = Auth.getUser();
    const form = el(`noteForm-${user}`);
    const msg = el(`noteMessage-${user}`);
    const status = el(`saveStatus-${user}`);
    const count = Number(countForToday || 0);
    if (!current) {
      form.style.display = 'none';
      msg.textContent = 'Sign in to post.';
      return;
    }
    if (current !== user) {
      form.style.display = 'none';
      msg.textContent = `Signed in as ${current}. Only ${user} can post here.`;
      return;
    }
    if (count >= 2) {
      form.style.display = 'none';
      msg.textContent = "You've used your one edit for today.";
      return;
    }
    // Allow editing; prefill latest text if present
    form.style.display = '';
    msg.textContent = count === 1 ? 'You can make one edit today.' : '';
    if (note) {
      const input = el(`noteText-${user}`);
      if (input && input.value === '') {
        input.value = note.text || '';
      }
    }
    status.textContent = '';
    // Ensure inputs are enabled
    form.querySelectorAll('textarea, input, button').forEach(node => { node.disabled = false; });
  }

  function start() {
    // Wire listeners and initial render
    for (const u of USERS) {
      const form = el(`noteForm-${u}`);
      if (!form) continue;
      const btn = el(`saveBtn-${u}`);
      const handler = onSubmitFactory(u);
      form.addEventListener('submit', handler);
      if (btn) btn.addEventListener('click', handler);
      refreshTodayFor(u);
    }
    // Expose global click helper as a backup for inline handlers
    window.App = window.App || {};
    window.App.save = function(user){
      const handler = onSubmitFactory(user);
      return handler();
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
