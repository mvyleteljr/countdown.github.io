**Current Behavior**
- Stores attachments inline in Postgres: each file is converted to a base64 data URL on the client and saved in `notes.attachments` (JSONB).
- Renders by fetching `/api/notes`, reconstructing each `dataUrl` into a Blob, and displaying via `URL.createObjectURL(blob)`.
- Both users see the same media because all data lives centrally in the DB and GET is open (no server auth on reads).

**Security Model**
- CORS allows any origin. GET is public; POST/DELETE can be locked with `API_SECRET` and `X-Token` (set in Vercel env and `assets/config.js`).
- Client sign‑in only gates UI inputs; it is not server authentication.

**Limitations**
- DB bloat: base64 inflates size (~33%) and grows Postgres rows quickly.
- Request/response size limits: large images can exceed function and network limits.
- No content validation: any file type/size can be uploaded.
- Performance: sending full data URLs on every GET is wasteful; no caching or thumbnails.

**Recommended Improvements**
- Move media to object storage (e.g., S3/Cloudflare R2/GCS) and store only URLs + metadata in `attachments`.
- Use presigned uploads from the client to the bucket; API only records metadata (name, type, size, url, optional width/height).
- Add client‑side validation: max size per file (e.g., 5–10 MB), allowed MIME types (images/videos only), and file count limits.
- Generate and store thumbnails for images to speed rendering; lazy‑load originals.
- Paginate or scope GET `/api/notes` (e.g., `?date=YYYY-MM-DD`) to reduce payload size.
- Tighten access: require `API_SECRET` for writes/deletes; consider read protection (private site) or signed URLs for media if buckets are private.

**Minimal S3 Plan (sketch)**
- API route `POST /api/notes/upload-url` returns presigned PUT URL + final public URL for each file.
- Client uploads files directly to S3 with `fetch(putUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type }})`.
- Client then calls existing `POST /api/notes` with attachments like `{ name, type, size, url }` (no `dataUrl`).
- Update renderer to use `att.url` directly; fallback to `dataUrl` only for legacy rows.

**Operational Notes**
- If keeping current design, at least cap file size and MIME types and consider limiting total attachment bytes per day.
- If `API_SECRET` is set, mirror it in `assets/config.js` as `apiSecret` so writes/deletes work.
 - Auto-refresh can be tuned in `assets/config.js` via `autoRefreshMs` (set to `0` to disable). UI refreshes are skipped while a user is actively editing to avoid flicker.
