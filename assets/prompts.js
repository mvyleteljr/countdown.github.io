(function(){
  const USERS = ['Marshall', 'Isobel'];
  const PROMPT_COUNT = 11;
  const registry = new Map();
  let sectionHidden = false;

  function todayKey() {
    if (window.Utils && typeof Utils.toDateKey === 'function') {
      return Utils.toDateKey(new Date());
    }
    const d = new Date();
    return d.toISOString().slice(0, 10);
  }

  let lastDateKey = todayKey();

  function el(id) { return document.getElementById(id); }

  function getCurrentUser() {
    try {
      if (window.Auth && typeof Auth.getUser === 'function') {
        return Auth.getUser();
      }
    } catch (_) {
      /* ignore */
    }
    return null;
  }

  function setSectionHidden(hidden) {
    if (sectionHidden === hidden) return;
    const section = el('promptsSection');
    if (!section) return;
    section.style.display = hidden ? 'none' : '';
    sectionHidden = hidden;
  }

  function buildUi() {
    for (const user of USERS) {
      const list = el(`promptList-${user}`);
      const message = el(`promptMessage-${user}`);
      if (!list || !message) continue;
      list.innerHTML = '';
      const fields = [];
      for (let i = 1; i <= PROMPT_COUNT; i += 1) {
        const item = document.createElement('div');
        item.className = 'prompt-item';
        const label = document.createElement('label');
        label.className = 'field';
        const span = document.createElement('span');
        span.textContent = `Prompt ${i}`;
        const textarea = document.createElement('textarea');
        textarea.rows = 2;
        textarea.id = `promptText-${user}-${i}`;
        label.append(span, textarea);
        item.appendChild(label);
        list.appendChild(item);
        fields.push(textarea);
      }
      const actionRow = document.createElement('div');
      actionRow.className = 'prompt-actions';
      const button = document.createElement('button');
      button.type = 'button';
      button.id = `promptSave-${user}`;
      button.className = 'btn btn-small';
      button.textContent = 'Save Prompts';
      actionRow.appendChild(button);
      list.appendChild(actionRow);
      const status = document.createElement('div');
      status.className = 'status';
      status.id = `promptStatus-${user}`;
      list.appendChild(status);
      registry.set(user, { list, message, fields, button, status });
      button.addEventListener('click', () => onSave(user));
    }
  }

  async function onSave(user) {
    const info = registry.get(user);
    if (!info) return;
    const current = getCurrentUser();
    if (!current || current !== user) {
      info.status.textContent = 'Not allowed.';
      return;
    }
    const payload = info.fields.map((field, idx) => {
      const trimmed = String(field.value || '').trim();
      field.value = trimmed;
      return { index: idx + 1, text: trimmed };
    });
    info.button.disabled = true;
    info.status.textContent = 'Saving…';
    let reenable = true;
    try {
      await DB.savePromptsForUser(user, payload);
      info.status.textContent = 'Saved!';
      setTimeout(() => {
        if (info.status.textContent === 'Saved!') info.status.textContent = '';
      }, 2000);
    } catch (err) {
      console.error(err);
      if (err && err.code === 'prompts-locked') {
        info.status.textContent = 'Prompts locked for today.';
        reenable = false;
        await refreshPromptsFor(user);
      } else {
        info.status.textContent = 'Failed to save prompts.';
      }
    } finally {
      if (reenable) info.button.disabled = false;
    }
  }

  async function refreshPromptsFor(user) {
    const info = registry.get(user);
    if (!info) return;
    const current = getCurrentUser();
    const isOwner = current === user;
    info.list.style.display = 'none';
    info.message.textContent = '';
    info.fields.forEach(field => { field.value = ''; field.disabled = true; });
    info.button.disabled = true;

    if (!current) {
      info.message.textContent = 'Sign in to write prompts.';
      setSectionHidden(false);
      return;
    }

    if (!isOwner) {
      info.message.textContent = `Only ${user} can write prompts here.`;
      return;
    }

    try {
      const data = await DB.getPromptsForUser(user);
      if (!data.editable && data.hasAny) {
        setSectionHidden(true);
        info.message.textContent = '';
        return;
      }
      setSectionHidden(false);
      info.list.style.display = '';
      const map = new Map();
      if (Array.isArray(data.prompts)) {
        for (const entry of data.prompts) {
          const idx = Number(entry && entry.index);
          if (!Number.isInteger(idx)) continue;
          map.set(idx, typeof entry.text === 'string' ? entry.text : '');
        }
      }
      info.fields.forEach((field, idx) => {
        const val = map.has(idx + 1) ? map.get(idx + 1) : '';
        field.value = val;
        field.disabled = !data.editable;
      });
      info.button.disabled = !data.editable;
      info.message.textContent = data.editable
        ? 'Draft your eleven prompts—they stay private and will be randomly shared over the next eleven days.'
        : 'Prompts locked until tomorrow.';
    } catch (err) {
      console.error(err);
      info.message.textContent = 'Unable to load prompts right now.';
      if (isOwner) setSectionHidden(false);
    }
  }

  let refreshing = null;

  async function refreshAll() {
    if (refreshing) return refreshing;
    refreshing = (async () => {
      try {
        for (const user of USERS) {
          await refreshPromptsFor(user);
        }
      } finally {
        lastDateKey = todayKey();
        refreshing = null;
      }
    })();
    return refreshing;
  }

  function maybeRefreshOnDateChange() {
    const key = todayKey();
    if (key !== lastDateKey) {
      lastDateKey = key;
      refreshAll();
    }
  }

  function start() {
    const section = el('promptsSection');
    if (!section) return;
    buildUi();
    refreshAll();
    window.addEventListener('auth-changed', refreshAll);
    setInterval(maybeRefreshOnDateChange, 60000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
