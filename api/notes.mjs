import { neon } from '@neondatabase/serverless';
export const config = { runtime: 'nodejs' };

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Token'
};

function send(res, status, body, extraHeaders = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', ...corsHeaders, ...extraHeaders });
  res.end(text);
}

function unauthorized(res) { send(res, 401, { ok: false, error: 'unauthorized' }); }

// Resolve DB URL once (support common provider names)
const dbUrl = process.env.DATABASE_URL
  || process.env.POSTGRES_URL
  || process.env.POSTGRES_PRISMA_URL
  || process.env.DATABASE_URL_UNPOOLED
  || process.env.POSTGRES_URL_NON_POOLING
  || process.env.NEON_DATABASE_URL
  || process.env.PG_CONNECTION_STRING;
const client = dbUrl ? neon(dbUrl) : null;

async function readJsonBody(req) {
  try {
    // If a framework populated req.body
    if (req && typeof req.body === 'string' && req.body.length) return JSON.parse(req.body);
    if (req && req.body && typeof req.body === 'object') return req.body;
  } catch { /* fall through to raw read */ }
  // Raw stream read (Node.js IncomingMessage)
  const data = await new Promise((resolve, reject) => {
    try {
      let buf = '';
      if (req.setEncoding) req.setEncoding('utf8');
      req.on('data', (chunk) => { buf += chunk; });
      req.on('end', () => resolve(buf));
      req.on('error', reject);
    } catch (e) { reject(e); }
  });
  if (!data) return {};
  try { return JSON.parse(data); } catch { return {}; }
}

// Ensure schema once at module init
async function ensureSchemaOnce() {
  if (!client) return;
  try {
    await client`create sequence if not exists notes_id_seq`;
    await client`
      create table if not exists notes (
        id bigint not null default nextval('notes_id_seq') primary key,
        user_name text not null,
        "timestamp" bigint not null,
        date_key text not null,
        "text" text not null,
        attachments jsonb not null default '[]'::jsonb,
        sync_key text
      )
    `;
    await client`create index if not exists idx_notes_date_key on notes(date_key)`;
    await client`create index if not exists idx_notes_timestamp on notes("timestamp" desc)`;
  } catch { /* ignore ensure errors; subsequent ops will surface issues */ }
}
await ensureSchemaOnce();

export default async function handler(req, res) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') return send(res, 200, { ok: true });

  const token = process.env.API_SECRET || '';
  const requireSecret = !!token;
  if (!client) {
    return send(res, 500, {
      ok: false,
      error: 'missing-database-url',
      hint: 'Set one of: DATABASE_URL, POSTGRES_URL, POSTGRES_URL_NON_POOLING, POSTGRES_PRISMA_URL, DATABASE_URL_UNPOOLED, NEON_DATABASE_URL, or PG_CONNECTION_STRING (then redeploy).'
    });
  }

  // Schema is ensured at module load

  if (req.method === 'GET') {
    const rows = await client`select id, user_name as user, "timestamp", date_key as "dateKey", "text", attachments from notes order by "timestamp" desc;`;
    return send(res, 200, { notes: rows } );
  }

  if (req.method === 'POST') {
    if (requireSecret && req.headers['x-token'] !== token) return unauthorized(res);
    const payload = await readJsonBody(req);
    if (!payload || typeof payload !== 'object') return send(res, 400, { ok:false, error:'invalid-json' });
    const now = Date.now();
    const ts = Number(payload.timestamp) || now;
    const user = typeof payload.user === 'string' ? payload.user : '';
    const dateKey = payload.dateKey || new Date(ts).toISOString().slice(0,10);
    const text = typeof payload.text === 'string' ? payload.text : '';
    const attachments = Array.isArray(payload.attachments) ? payload.attachments : [];
    if (!user) return send(res, 400, { ok:false, error:'user-required' });
    // Enforce one post per day: allow at most 1 per user per dateKey
    const count = await client`select count(*)::int as c from notes where user_name = ${user} and date_key = ${dateKey}`;
    if (count[0].c >= 1) return send(res, 400, { ok:false, error:'daily-limit-reached' });
    const rows = await client`
      insert into notes (user_name, "timestamp", date_key, "text", attachments)
      values (${user}, ${ts}, ${dateKey}, ${text}, ${JSON.stringify(attachments)}::jsonb)
      returning id, user_name as user, "timestamp", date_key as "dateKey", "text", attachments;
    `;
    return send(res, 200, { ok:true, note: rows[0] });
  }

  if (req.method === 'DELETE') {
    if (requireSecret && req.headers['x-token'] !== token) return unauthorized(res);
    const url = new URL(req.url, 'http://x');
    const scope = url.searchParams.get('scope') || 'all';
    if (scope === 'today') {
      const today = new Date();
      const dateKey = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
      await client`delete from notes where date_key = ${dateKey}`;
      return send(res, 200, { ok:true });
    } else {
      await client`truncate table notes`;
      return send(res, 200, { ok:true });
    }
  }

  return send(res, 404, { ok:false, error:'not-found' });
}
