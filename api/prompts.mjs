import { neon } from '@neondatabase/serverless';
export const config = { runtime: 'nodejs' };

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Token, X-Viewer'
};

function send(res, status, body, extraHeaders = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', ...corsHeaders, ...extraHeaders });
  res.end(text);
}

function unauthorized(res) {
  send(res, 401, { ok: false, error: 'unauthorized' });
}

const ALLOWED_USERS = new Set(['Marshall', 'Isobel']);
const PROMPT_COUNT = 11;

const dbUrl = process.env.DATABASE_URL
  || process.env.POSTGRES_URL
  || process.env.POSTGRES_PRISMA_URL
  || process.env.DATABASE_URL_UNPOOLED
  || process.env.POSTGRES_URL_NON_POOLING
  || process.env.NEON_DATABASE_URL
  || process.env.PG_CONNECTION_STRING;
const client = dbUrl ? neon(dbUrl) : null;

function toDateKey(d) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
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
    /* ignored */
  }
  const data = await new Promise((resolve, reject) => {
    try {
      let buf = '';
      if (req.setEncoding) req.setEncoding('utf8');
      req.on('data', (chunk) => { buf += chunk; });
      req.on('end', () => resolve(buf));
      req.on('error', reject);
    } catch (e) {
      reject(e);
    }
  });
  if (!data) return {};
  try { return JSON.parse(data); } catch (_) { return {}; }
}

async function ensureSchemaOnce() {
  if (!client) return;
  try {
    await client`create sequence if not exists prompts_id_seq`;
    await client`
      create table if not exists prompts (
        id bigint not null default nextval('prompts_id_seq') primary key,
        user_name text not null,
        prompt_index int not null,
        text text not null default '',
        date_key text not null,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )
    `;
    await client`create unique index if not exists idx_prompts_user_date_index on prompts(user_name, date_key, prompt_index)`;
    await client`create index if not exists idx_prompts_date_key on prompts(date_key)`;
  } catch (_) {
    // ignore ensure errors; subsequent operations will surface the issue
  }
}
await ensureSchemaOnce();

function sanitizeUser(name) {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  if (!ALLOWED_USERS.has(trimmed)) return '';
  return trimmed;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return send(res, 200, { ok: true });
  }

  if (!client) {
    return send(res, 500, {
      ok: false,
      error: 'missing-database-url',
      hint: 'Set DATABASE_URL (or compatible POSTGRES_* env) then redeploy.'
    });
  }

  const token = process.env.API_SECRET || '';
  const requireSecret = !!token;

  const viewer = sanitizeUser(firstHeader(req, 'x-viewer'));

  if (req.method === 'GET') {
    const url = new URL(req.url, 'http://local');
    const requestedUser = sanitizeUser(url.searchParams.get('user'));
    if (!requestedUser) return send(res, 400, { ok: false, error: 'user-required' });
    if (!viewer || viewer !== requestedUser) return unauthorized(res);

    const todayKey = toDateKey(new Date());
    let dateKey = url.searchParams.get('dateKey');
    if (dateKey) {
      dateKey = String(dateKey).trim();
    }
    if (!dateKey) {
      const latest = await client`
        select date_key from prompts where user_name = ${requestedUser}
        order by date_key desc limit 1
      `;
      dateKey = latest.length ? latest[0].date_key : todayKey;
    }

    const rows = await client`
      select prompt_index as "index", text, date_key as "dateKey"
      from prompts
      where user_name = ${requestedUser} and date_key = ${dateKey}
      order by prompt_index asc
    `;

    const isToday = dateKey === todayKey;
    const editable = isToday && viewer === requestedUser;
    const payload = editable ? rows : [];

    return send(res, 200, {
      ok: true,
      prompts: payload,
      dateKey,
      editable,
      hasAny: rows.length > 0
    });
  }

  if (req.method === 'POST') {
    if (requireSecret && firstHeader(req, 'x-token') !== token) return unauthorized(res);

    const payload = await readJsonBody(req);
    const user = sanitizeUser(payload && payload.user);
    if (!user) return send(res, 400, { ok: false, error: 'user-required' });
    if (!viewer || viewer !== user) return unauthorized(res);

    const now = new Date();
    const todayKey = toDateKey(now);
    const targetDate = payload && typeof payload.dateKey === 'string' && payload.dateKey.trim()
      ? payload.dateKey.trim()
      : todayKey;
    if (targetDate !== todayKey) {
      return send(res, 403, { ok: false, error: 'prompts-locked' });
    }

    const items = Array.isArray(payload && payload.prompts) ? payload.prompts : [];
    const map = new Map();
    for (const entry of items) {
      if (!entry) continue;
      const idx = Number(entry.index);
      if (!Number.isInteger(idx) || idx < 1 || idx > PROMPT_COUNT) continue;
      const txt = typeof entry.text === 'string' ? entry.text : '';
      map.set(idx, txt);
    }

    const normalized = [];
    for (let i = 1; i <= PROMPT_COUNT; i += 1) {
      const text = map.has(i) ? map.get(i) : '';
      normalized.push({ index: i, text: text });
    }

    const saved = [];
    for (const item of normalized) {
      const result = await client`
        insert into prompts (user_name, prompt_index, text, date_key, created_at, updated_at)
        values (${user}, ${item.index}, ${item.text}, ${todayKey}, now(), now())
        on conflict (user_name, date_key, prompt_index)
        do update set text = excluded.text, updated_at = now()
        returning prompt_index as "index", text, date_key as "dateKey"
      `;
      if (result && result[0]) saved.push(result[0]);
    }

    return send(res, 200, { ok: true, prompts: saved, dateKey: todayKey });
  }

  if (req.method === 'DELETE') {
    if (requireSecret && firstHeader(req, 'x-token') !== token) return unauthorized(res);
    const url = new URL(req.url, 'http://local');
    const scope = (url.searchParams.get('scope') || 'all').toLowerCase();
    if (scope === 'today') {
      const todayKey = toDateKey(new Date());
      await client`delete from prompts where date_key = ${todayKey}`;
    } else if (scope === 'user') {
      const targetUser = sanitizeUser(url.searchParams.get('user'));
      if (!targetUser) return send(res, 400, { ok: false, error: 'user-required' });
      await client`delete from prompts where user_name = ${targetUser}`;
    } else {
      await client`truncate table prompts`;
    }
    return send(res, 200, { ok: true });
  }

  return send(res, 404, { ok: false, error: 'not-found' });
}
