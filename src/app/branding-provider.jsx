import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { retryDataLoad, subscribeToTables, throwIfError } from "@/lib/backend/shared";

const BrandingContext = createContext(null);
const DEFAULT_BRANDING = { sidebar_title: "RUNBOOK", logo_path: "" };

export function BrandingProvider({ children }) {
  const [branding, setBranding] = useState(DEFAULT_BRANDING);
  const [logoUrl, setLogoUrl] = useState("");
  const [loading, setLoading] = useState(isSupabaseConfigured);
  const [error, setError] = useState("");
  const requestRef = useRef(0);

  const refresh = useCallback(async () => {
    if (!supabase) { setLoading(false); return; }
    const requestId = ++requestRef.current;
    try {
      const { data, error: queryError } = await supabase.from("workspace_branding").select("sidebar_title,logo_path").eq("singleton", true).maybeSingle();
      throwIfError(queryError);
      const next = { ...DEFAULT_BRANDING, ...(data ?? {}) };
      if (requestId !== requestRef.current) return;
      setBranding(next);
      const { data: urlData } = next.logo_path ? supabase.storage.from("runbook-public").getPublicUrl(next.logo_path) : { data: { publicUrl: "" } };
      setLogoUrl(urlData.publicUrl ?? "");
      setError("");
    } catch (cause) { if (requestId === requestRef.current) setError(cause.message || "Branding could not be loaded."); }
    finally { if (requestId === requestRef.current) setLoading(false); }
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured) { setLoading(false); return undefined; }
    let active = true;
    void retryDataLoad(refresh);
    const unsubscribe = subscribeToTables(["workspace_branding"], () => { if (active) void retryDataLoad(refresh); }, "workspace-branding");
    return () => { active = false; unsubscribe(); };
  }, [refresh]);

  const value = useMemo(() => ({
    branding, logoUrl, loading, error,
    async save({ title, file, actorId }) {
      if (!supabase) throw new Error("Connect Supabase before changing sidebar branding.");
      let logoPath = branding.logo_path || "";
      if (file) {
        const extension = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : file.type === "image/gif" ? "gif" : "jpg";
        logoPath = `branding/sidebar-${crypto.randomUUID()}.${extension}`;
        const { error: uploadError } = await supabase.storage.from("runbook-public").upload(logoPath, file, { contentType: file.type, upsert: false });
        throwIfError(uploadError);
      }
      const { error: saveError } = await supabase.from("workspace_branding").upsert({ singleton: true, sidebar_title: title.trim(), logo_path: logoPath, updated_at: new Date().toISOString(), updated_by: actorId || null });
      throwIfError(saveError);
      await refresh();
    },
  }), [branding, error, loading, logoUrl, refresh]);

  return <BrandingContext.Provider value={value}>{children}</BrandingContext.Provider>;
}

export function useBranding() {
  const value = useContext(BrandingContext);
  if (!value) throw new Error("useBranding must be used within BrandingProvider.");
  return value;
}
