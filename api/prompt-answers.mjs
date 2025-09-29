import { neon } from '@neondatabase/serverless';
export const config = { runtime: 'nodejs' };

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Token, X-Viewer'
};

const USERS = ['Marshall', 'Isobel'];
const PROMPT_COUNT = 11;
const REVEAL_DATE_KEY = '2025-10-13';

const dbUrl = process.env.DATABASE_URL
  || process.env.POSTGRES_URL
  || process.env.POSTGRES_PRISMA_URL
  || process.env.DATABASE_URL_UNPOOLED
  || process.env.POSTGRES_URL_NON_POOLING
  || process.env.NEON_DATABASE_URL
  || process.env.PG_CONNECTION_STRING;
const client = dbUrl ? neon(dbUrl) : null;

function send(res, status, body, extra = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', ...corsHeaders, ...extra });
  res.end(text);
}

function unauthorized(res) {
  send(res, 401, { ok: false, error: 'unauthorized' });
}

function sanitizeUser(name) {
  const normalized = typeof name === 'string' ? name.trim() : '';
  return USERS.includes(normalized) ? normalized : '';
}

function otherUser(user) {
  return user === 'Marshall' ? 'Isobel' : 'Marshall';
}

function toDateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function firstHeader(req, name) {
  const raw = req && req.headers ? req.headers[name] : null;
  if (!raw) return '';
  return Array.isArray(raw) ? (raw[0] || '') : raw;
}

async function readJsonBody(req) {
  try {
    if (req && typeof req.body === 'string' && req.body.length) return JSON.parse(req.body);
    if (req && req.body && typeof req.body === 'object') return req.body;
  } catch (_) {
    /* ignore */
  }
  const data = await new Promise((resolve, reject) => {
    try {
      let buf = '';
      if (req.setEncoding) req.setEncoding('utf8');
      req.on('data', (chunk) => { buf += chunk; });
      req.on('end', () => resolve(buf));
      req.on('error', reject);
    } catch (err) {
      reject(err);
    }
  });
  if (!data) return {};
  try { return JSON.parse(data); } catch (_) { return {}; }
}

async function ensureSchemaOnce() {
  if (!client) return;
  try {
    await client`create sequence if not exists answers_id_seq`;
    await client`
      create table if not exists answers (
        id bigint not null default nextval('answers_id_seq') primary key,
        answerer_name text not null,
        prompt_owner text not null,
        prompt_index int not null,
        source_date_key text not null,
        date_key text not null,
        prompt_text text not null default '',
        answer_text text not null default '',
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )
    `;
    await client`create unique index if not exists idx_answers_answerer_date on answers(answerer_name, date_key)`;
    await client`create unique index if not exists idx_answers_unique on answers(answerer_name, source_date_key, prompt_index)`;
    try {
      await client`
        insert into answers (answerer_name, prompt_owner, prompt_index, source_date_key, date_key, prompt_text, answer_text, created_at, updated_at)
        select answerer_name, prompt_owner, prompt_index, source_date_key, date_key, prompt_text, answer_text, created_at, updated_at
        from prompt_answers
        on conflict (answerer_name, source_date_key, prompt_index) do nothing
      `;
    } catch (_) {
      /* ignore if legacy table missing */
    }
  } catch (_) {
    /* ignore ensure errors */
  }
}
await ensureSchemaOnce();

function revealReached(now = new Date()) {
  return toDateKey(now) >= REVEAL_DATE_KEY;
}

async function fetchLatestPromptSet(owner) {
  const latest = await client`
    select date_key
    from prompts
    where user_name = ${owner}
    order by date_key desc
    limit 1
  `;
  if (!latest.length) return null;
  const dateKey = latest[0].date_key;
  const prompts = await client`
    select prompt_index as "index", text
    from prompts
    where user_name = ${owner} and date_key = ${dateKey}
    order by prompt_index asc
  `;
  return { dateKey, prompts };
}

async function ensureAssignmentFor(answerer, viewerToday) {
  const todayKey = toDateKey(viewerToday);
  const existing = await client`
    select id, answerer_name as "answerer", prompt_owner as "owner", prompt_index as "index",
           source_date_key as "sourceDateKey", date_key as "dateKey", prompt_text as "promptText",
           answer_text as "answerText", updated_at as "updatedAt"
    from answers
    where answerer_name = ${answerer} and date_key = ${todayKey}
    limit 1
  `;
  if (existing.length) return { record: existing[0], created: false };

  const owner = otherUser(answerer);
  const latest = await fetchLatestPromptSet(owner);
  if (!latest) {
    return { error: 'prompts-not-found' };
  }

  const { dateKey: sourceDateKey, prompts } = latest;
  if (!Array.isArray(prompts) || prompts.length < PROMPT_COUNT) {
    return { error: 'prompts-incomplete' };
  }

  const todayDateKey = toDateKey(viewerToday);
  if (sourceDateKey === todayDateKey) {
    return { error: 'prompts-today' };
  }

  const used = await client`
    select prompt_index as "index"
    from answers
    where answerer_name = ${answerer}
      and source_date_key = ${sourceDateKey}
  `;
  const usedSet = new Set(used.map((row) => row.index));
  const available = prompts.filter((p) => !usedSet.has(p.index));
  if (!available.length) {
    return { error: 'prompts-exhausted' };
  }

  const pick = available[Math.floor(Math.random() * available.length)];
  const inserted = await client`
    insert into answers (answerer_name, prompt_owner, prompt_index, source_date_key, date_key, prompt_text)
    values (${answerer}, ${owner}, ${pick.index}, ${sourceDateKey}, ${todayDateKey}, ${pick.text || ''})
    on conflict (answerer_name, date_key) do nothing
    returning id, answerer_name as "answerer", prompt_owner as "owner", prompt_index as "index",
              source_date_key as "sourceDateKey", date_key as "dateKey", prompt_text as "promptText",
              answer_text as "answerText", updated_at as "updatedAt"
  `;
  if (inserted.length) return { record: inserted[0], created: true };

  const fallback = await client`
    select id, answerer_name as "answerer", prompt_owner as "owner", prompt_index as "index",
           source_date_key as "sourceDateKey", date_key as "dateKey", prompt_text as "promptText",
           answer_text as "answerText", updated_at as "updatedAt"
    from answers
    where answerer_name = ${answerer} and date_key = ${todayDateKey}
    limit 1
  `;
  if (fallback.length) return { record: fallback[0], created: false };
  return { error: 'assignment-failed' };
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return send(res, 200, { ok: true });

  if (!client) {
    return send(res, 500, { ok: false, error: 'missing-database-url' });
  }

  const token = process.env.API_SECRET || '';
  const requireSecret = !!token;
  const viewer = sanitizeUser(firstHeader(req, 'x-viewer'));

  if (req.method === 'GET') {
    const url = new URL(req.url, 'http://local');
    const user = sanitizeUser(url.searchParams.get('user'));
    const mode = (url.searchParams.get('mode') || '').toLowerCase();

    if (mode === 'reveal') {
      if (!viewer) return unauthorized(res);
      if (!user) return send(res, 400, { ok: false, error: 'user-required' });
      if (!revealReached()) {
        return send(res, 200, { ok: true, status: 'not-ready', reason: 'before-reveal' });
      }
      const rows = await client`
        select answerer_name as "answerer", prompt_owner as "owner", prompt_index as "index",
               source_date_key as "sourceDateKey", date_key as "dateKey", prompt_text as "promptText",
               answer_text as "answerText", created_at, updated_at
        from answers
        order by date_key asc, answerer_name asc
      `;
      return send(res, 200, {
        ok: true,
        status: 'reveal',
        answers: rows
      });
    }

    if (!user) return send(res, 400, { ok: false, error: 'user-required' });
    if (!viewer || viewer !== user) return unauthorized(res);

    const today = new Date();
    const result = await ensureAssignmentFor(user, today);
    if (result.error) {
      switch (result.error) {
        case 'prompts-not-found':
          return send(res, 200, { ok: true, status: 'not-ready', reason: 'no-prompts' });
        case 'prompts-incomplete':
          return send(res, 200, { ok: true, status: 'not-ready', reason: 'incomplete-prompts' });
        case 'prompts-today':
          return send(res, 200, { ok: true, status: 'not-ready', reason: 'same-day' });
        case 'prompts-exhausted':
          return send(res, 200, { ok: true, status: 'exhausted' });
        default:
          return send(res, 500, { ok: false, error: result.error });
      }
    }

    const { record } = result;
    return send(res, 200, {
      ok: true,
      status: 'ready',
      prompt: {
        index: record.index,
        owner: record.owner,
        text: record.promptText,
        sourceDateKey: record.sourceDateKey
      },
      answer: {
        text: record.answerText,
        updatedAt: record.updatedAt
      },
      dateKey: record.dateKey
    });
  }

  if (req.method === 'POST') {
    if (requireSecret && firstHeader(req, 'x-token') !== token) return unauthorized(res);
    const payload = await readJsonBody(req);
    const user = sanitizeUser(payload && payload.user);
    if (!user) return send(res, 400, { ok: false, error: 'user-required' });
    if (!viewer || viewer !== user) return unauthorized(res);

    const answerText = payload && typeof payload.answerText === 'string' ? payload.answerText : '';
    const todayKey = toDateKey(new Date());
    const updated = await client`
      update answers
      set answer_text = ${answerText}, updated_at = now()
      where answerer_name = ${user} and date_key = ${todayKey}
      returning id
    `;
    if (!updated.length) return send(res, 404, { ok: false, error: 'assignment-missing' });
    return send(res, 200, { ok: true });
  }

  if (req.method === 'DELETE') {
    if (requireSecret && firstHeader(req, 'x-token') !== token) return unauthorized(res);
    const url = new URL(req.url, 'http://local');
    const scope = (url.searchParams.get('scope') || 'all').toLowerCase();
    if (scope === 'today') {
      const todayKey = toDateKey(new Date());
      await client`delete from answers where date_key = ${todayKey}`;
    } else if (scope === 'user') {
      const user = sanitizeUser(url.searchParams.get('user'));
      if (!user) return send(res, 400, { ok: false, error: 'user-required' });
      await client`delete from answers where answerer_name = ${user}`;
    } else {
      await client`truncate table answers`;
    }
    return send(res, 200, { ok: true });
  }

  return send(res, 404, { ok: false, error: 'not-found' });
}
