(function(){
  const USERS = ['Marshall', 'Isobel'];
  const REVEAL_DATE_KEY = '2025-10-13';
  const registry = new Map();
  let sectionVisible = false;
  let revealSection = null;
  let revealMessage = null;
  const revealLists = Object.create(null);

  function el(id) { return document.getElementById(id); }

  function todayKey() {
    if (window.Utils && typeof Utils.toDateKey === 'function') {
      return Utils.toDateKey(new Date());
    }
    const now = new Date();
    return now.toISOString().slice(0, 10);
  }

  function getCurrentUser() {
    try {
      if (window.Auth && typeof Auth.getUser === 'function') return Auth.getUser();
    } catch (_) {
      /* ignore */
    }
    return null;
  }

  function revealReached() {
    return todayKey() >= REVEAL_DATE_KEY;
  }

  function otherUser(user) {
    return user === 'Marshall' ? 'Isobel' : 'Marshall';
  }

  function setSectionVisible(show) {
    if (sectionVisible === show) return;
    const section = el('answersSection');
    if (!section) return;
    section.style.display = show ? '' : 'none';
    sectionVisible = show;
  }

  function ensureRevealSection() {
    if (revealSection && revealMessage && revealLists.Marshall && revealLists.Isobel) return true;
    const main = document.querySelector('main.container');
    if (!main) return false;

    const section = document.createElement('section');
    section.id = 'answersRevealSection';
    section.className = 'answers-reveal';
    section.style.display = 'none';
    section.dataset.dynamic = 'true';

    const heading = document.createElement('h2');
    heading.textContent = 'Shared Prompt Answers';
    const message = document.createElement('p');
    message.id = 'answersRevealMessage';
    message.className = 'muted';

    const wrap = document.createElement('div');
    wrap.className = 'two-col';

    for (const user of USERS) {
      const card = document.createElement('div');
      card.className = 'note-card';
      card.dataset.user = user;
      const title = document.createElement('h3');
      title.textContent = `${user}'s Reflections`;
      const list = document.createElement('div');
      list.id = `revealList-${user}`;
      list.className = 'reveal-list';
      card.append(title, list);
      wrap.appendChild(card);
      revealLists[user] = list;
    }

    section.append(heading, message, wrap);
    main.appendChild(section);

    revealSection = section;
    revealMessage = message;
    return true;
  }

  function buildUi() {
    for (const user of USERS) {
      const card = el(`answerCard-${user}`);
      const message = el(`answerMessage-${user}`);
      const promptWrap = el(`answerPrompt-${user}`);
      const promptText = el(`answerPromptText-${user}`);
      const area = el(`answerTextarea-${user}`);
      const saveBtn = el(`answerSave-${user}`);
      const status = el(`answerStatus-${user}`);
      if (!card || !message || !promptWrap || !promptText || !area || !saveBtn || !status) continue;
      saveBtn.addEventListener('click', () => onSave(user));
      registry.set(user, { card, message, promptWrap, promptText, area, saveBtn, status });
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
    const value = String(info.area.value || '').trim();
    info.area.value = value;
    info.saveBtn.disabled = true;
    info.status.textContent = 'Saving…';
    try {
      await DB.savePromptAnswer(user, value);
      info.status.textContent = 'Saved!';
      setTimeout(() => {
        if (info.status.textContent === 'Saved!') info.status.textContent = '';
      }, 2000);
    } catch (err) {
      console.error(err);
      if (err && err.code === 'assignment-missing') {
        info.status.textContent = 'No prompt assigned right now.';
        await refreshFor(user);
      } else {
        info.status.textContent = 'Failed to save answer.';
      }
    } finally {
      info.saveBtn.disabled = false;
    }
  }

  function renderOwnerMessage(viewer, target, ready) {
    const info = registry.get(target);
    if (!info) return;
    if (!viewer || viewer === target) return; // only for other person
    info.promptWrap.style.display = 'none';
    info.area.style.display = 'none';
    info.saveBtn.style.display = 'none';
    info.status.style.display = 'none';
    info.message.textContent = ready
      ? `Shhh! ${target} is answering one of your prompts today!`
      : `${target} will start answering your prompts soon.`;
  }

  async function refreshFor(user) {
    const info = registry.get(user);
    if (!info) return;
    const current = getCurrentUser();
    info.message.textContent = '';
    info.status.textContent = '';
    info.promptWrap.style.display = 'none';
    info.area.style.display = 'none';
    info.saveBtn.style.display = 'none';
    info.status.style.display = 'none';

    if (!current) {
      info.message.textContent = 'Sign in to see today\'s prompt.';
      return;
    }

    if (current !== user) {
      renderOwnerMessage(current, user, sectionVisible);
      return;
    }

    let data;
    try {
      data = await DB.getDailyPrompt(user);
    } catch (err) {
      console.error(err);
      info.message.textContent = 'Unable to load your prompt right now.';
      return;
    }

    if (!data || data.ok !== true) {
      info.message.textContent = 'No prompt available yet.';
      return;
    }

    if (data.status === 'not-ready') {
      info.message.textContent = 'Come back tomorrow once prompts are locked in.';
      return;
    }

    if (data.status === 'exhausted') {
      info.message.textContent = 'You\'ve answered all prompts from the current set.';
      return;
    }

    if (data.status !== 'ready' || !data.prompt) {
      info.message.textContent = 'No prompt available right now.';
      return;
    }

    const prompt = data.prompt;
    info.promptWrap.style.display = '';
    info.area.style.display = '';
    info.saveBtn.style.display = '';
    info.status.style.display = '';
    info.promptText.textContent = prompt.text || '(blank prompt)';
    const answerText = data.answer && typeof data.answer.text === 'string' ? data.answer.text : '';
    info.area.value = answerText;
    info.message.textContent = `From ${prompt.owner}'s prompt set (${prompt.sourceDateKey}).`;
  }

  async function refreshAll() {
    const current = getCurrentUser();
    if (!current) {
      setSectionVisible(false);
      await Promise.all(USERS.map((user) => refreshFor(user)));
      await refreshReveal();
      return;
    }

    await refreshFor(current);
    const ready = registry.has(current) && registry.get(current).promptWrap.style.display !== 'none';
    setSectionVisible(ready);

    const other = otherUser(current);
    await refreshFor(other);
    await refreshReveal();
  }

  function renderRevealLists(data) {
    for (const name of USERS) {
      const wrap = revealLists[name];
      if (wrap) wrap.innerHTML = '';
    }
    if (!data || !Array.isArray(data)) return;
    const groups = new Map();
    for (const user of USERS) groups.set(user, []);
    for (const row of data) {
      if (!row) continue;
      const answerer = USERS.includes(row.answerer) ? row.answerer : null;
      if (!answerer) continue;
      groups.get(answerer).push(row);
    }
    for (const user of USERS) {
      const wrap = revealLists[user];
      if (!wrap) continue;
      const items = groups.get(user) || [];
      if (!items.length) {
        const empty = document.createElement('p');
        empty.className = 'muted';
        empty.textContent = 'No answers saved yet.';
        wrap.appendChild(empty);
        continue;
      }
      items.sort((a, b) => {
        const ak = String(a.dateKey || '');
        const bk = String(b.dateKey || '');
        if (ak < bk) return -1;
        if (ak > bk) return 1;
        return Number(a.index || 0) - Number(b.index || 0);
      });
      for (const entry of items) {
        const card = document.createElement('div');
        card.className = 'reveal-item';
        const meta = document.createElement('div');
        meta.className = 'reveal-meta';
        const owner = entry.owner || otherUser(user);
        const day = entry.dateKey || '';
        meta.textContent = `Prompt from ${owner} • Answered on ${day}`;
        const prompt = document.createElement('div');
        prompt.className = 'reveal-prompt';
        prompt.textContent = entry.promptText || '(blank prompt)';
        const answer = document.createElement('div');
        answer.className = 'reveal-answer';
        const text = typeof entry.answerText === 'string' && entry.answerText.trim().length
          ? entry.answerText
          : 'No answer recorded.';
        if (text === 'No answer recorded.') {
          const span = document.createElement('span');
          span.className = 'muted';
          span.textContent = text;
          answer.appendChild(span);
        } else {
          answer.textContent = text;
        }
        card.append(meta, prompt, answer);
        wrap.appendChild(card);
      }
    }
  }

  async function refreshReveal() {
    if (!revealReached()) {
      if (revealSection) {
        revealSection.style.display = 'none';
        revealMessage.textContent = '';
        for (const name of USERS) {
          const wrap = revealLists[name];
          if (wrap) wrap.innerHTML = '';
        }
      }
      return;
    }

    const current = getCurrentUser();
    if (!current) {
      if (revealSection) revealSection.style.display = 'none';
      return;
    }

    if (!ensureRevealSection()) return;

    revealSection.style.display = '';
    revealMessage.textContent = 'Gathering your shared answers…';
    try {
      const data = await DB.getRevealAnswers(current);
      if (!data || data.status !== 'reveal') {
        revealMessage.textContent = 'Answers are not ready yet.';
        for (const name of USERS) {
          const wrap = revealLists[name];
          if (wrap) wrap.innerHTML = '';
        }
        return;
      }
      revealMessage.textContent = 'Here are the prompts and reflections you unlocked together.';
      renderRevealLists(data.answers || []);
    } catch (err) {
      console.error(err);
      revealMessage.textContent = 'Unable to load shared answers right now.';
      for (const name of USERS) {
        const wrap = revealLists[name];
        if (wrap) wrap.innerHTML = '';
      }
    }
  }

  function start() {
    const section = el('answersSection');
    if (!section) return;
    try {
      const stale = document.getElementById('answersRevealSection');
      if (stale && !stale.dataset.dynamic) {
        stale.parentNode.removeChild(stale);
      }
    } catch (_) {
      /* ignore */
    }
    buildUi();
    refreshAll();
    window.addEventListener('auth-changed', refreshAll);
    setInterval(refreshAll, 60000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
