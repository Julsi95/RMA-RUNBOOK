const DEFAULT_ALLOWED_ORIGINS = [
  "https://rma-runbook.vercel.app",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];

function allowedOrigins() {
  const configured = Deno.env.get("RUNBOOK_ALLOWED_ORIGINS")
    ?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  return new Set([...DEFAULT_ALLOWED_ORIGINS, ...(configured ?? [])]);
}

function isRunbookPreviewOrigin(origin: string | null) {
  if (!origin) return false;
  try {
    const url = new URL(origin);
    return url.protocol === "https:" && /^rma-runbook(?:-[a-z0-9-]+)?\.vercel\.app$/i.test(url.hostname);
  } catch {
    return false;
  }
}

export function corsHeaders(request: Request) {
  const origin = request.headers.get("Origin");
  const headers = new Headers({
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  });
  if (origin && (allowedOrigins().has(origin) || isRunbookPreviewOrigin(origin))) headers.set("Access-Control-Allow-Origin", origin);
  return headers;
}

export function isAllowedOrigin(request: Request) {
  const origin = request.headers.get("Origin");
  return !origin || allowedOrigins().has(origin) || isRunbookPreviewOrigin(origin);
}
