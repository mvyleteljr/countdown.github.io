// Remote API configuration. Leave apiBase empty to use same-origin.
// For local dev with `vercel dev`, this typically runs on http://localhost:3000.
window.Config = {
  apiBase: "", // e.g., "http://localhost:3000"; empty = same-origin
  apiSecret: "", // set if API_SECRET is configured in your Vercel env
  // Auto-refresh UI every N ms (0 disables). Prevents flicker during edits.
  autoRefreshMs: 0
};
