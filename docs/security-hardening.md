# Browser and Edge Function Security

## Allowed browser origins

The `manage-account` and `sync-holidays` Edge Functions allow the production app origin and local Vite development origins by default. Set `RUNBOOK_ALLOWED_ORIGINS` in Supabase Function secrets to a comma-separated list of exact origins when using a custom domain or Vercel preview deployment. Do not add a wildcard.

Example:

```powershell
supabase secrets set RUNBOOK_ALLOWED_ORIGINS="https://rma-runbook.vercel.app,https://your-preview.example"
```

After changing this value, redeploy the affected Supabase Functions. CORS only restricts browser origins; the functions still verify the caller's access token and server-side role.

## Session token storage

The current app is a browser SPA using `@supabase/supabase-js` directly for Auth, database queries, Storage, and Realtime. Supabase therefore persists the session in browser storage, where JavaScript can access it. `HttpOnly` cookies cannot be enabled safely by changing the client storage option: JavaScript cannot set an HttpOnly cookie, and the browser currently needs the Supabase session for direct API and Realtime calls.

Moving tokens to HttpOnly cookies requires a server-side authentication/BFF architecture (or a supported SSR architecture), with server routes proxying protected database, Storage, and session operations. This must be designed as a separate migration; do not copy tokens into a custom cookie from frontend code.

## Content policy

The Vercel response policy allows the app itself and Supabase HTTPS/WebSocket endpoints. It permits remote HTTPS images because published dashboards and employee records may use externally hosted images. If the Supabase project uses a custom API hostname, add that exact hostname to `connect-src` in `vercel.json` before deployment.
