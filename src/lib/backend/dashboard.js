import { assertBackendConfigured, throwIfError } from "./shared.js";
import { supabase } from "@/lib/supabase";

export async function loadPublishedDashboard() {
  assertBackendConfigured();
  const { data: publication, error: pointerError } = await supabase.from("dashboard_publication").select("revision_id").eq("singleton", true).maybeSingle();
  throwIfError(pointerError);
  if (!publication?.revision_id) return null;
  const { data, error } = await supabase.from("dashboard_revisions").select("content").eq("id", publication.revision_id).single();
  throwIfError(error);
  return data.content;
}

export async function loadPublicWorkspaceDashboard() {
  assertBackendConfigured();
  const { data, error } = await supabase.rpc("get_public_workspace_dashboard");
  throwIfError(error);
  return data;
}

export async function loadDashboardDraft(ownerId) {
  assertBackendConfigured();
  const { data, error } = await supabase.from("dashboard_drafts").select("content").eq("owner_id", ownerId).maybeSingle();
  throwIfError(error);
  return data?.content ?? null;
}

export async function saveDashboardDraft(ownerId, content) {
  assertBackendConfigured();
  const document = await storeDashboardImages(content);
  const { error } = await supabase.from("dashboard_drafts").upsert({ owner_id: ownerId, content: document, updated_at: new Date().toISOString() });
  throwIfError(error);
  return document;
}

export async function discardDashboardDraft(ownerId) {
  assertBackendConfigured();
  const { error } = await supabase.from("dashboard_drafts").delete().eq("owner_id", ownerId);
  throwIfError(error);
}

const dashboardImageCache = new Map();

async function storeDashboardImages(content) {
  const uploaded = new Map();
  async function publicImage(source, containerId, index) {
    if (!source?.startsWith("data:image/")) return source ?? "";
    if (uploaded.has(source)) return uploaded.get(source);
    if (dashboardImageCache.has(source)) {
      const cached = dashboardImageCache.get(source);
      uploaded.set(source, cached);
      return cached;
    }
    const blob = await (await fetch(source)).blob();
    const extension = blob.type === "image/png" ? "png" : blob.type === "image/gif" ? "gif" : blob.type === "image/jpeg" ? "jpg" : "webp";
    const path = `dashboard/${containerId}/${crypto.randomUUID()}-${index}.${extension}`;
    const { error } = await supabase.storage.from("runbook-public").upload(path, blob, { contentType: blob.type, upsert: false });
    throwIfError(error);
    const { data } = supabase.storage.from("runbook-public").getPublicUrl(path);
    uploaded.set(source, data.publicUrl);
    dashboardImageCache.set(source, data.publicUrl);
    return data.publicUrl;
  }
  const containers = await Promise.all((content.containers ?? []).map(async (container) => {
    const images = await Promise.all((container.images ?? []).map(async (image, index) => ({
      ...image, src: await publicImage(image.src, container.id, index),
    })));
    const image = container.image ? await publicImage(container.image, container.id, 0) : images[0]?.src ?? "";
    return { ...container, images, image };
  }));
  return { ...content, containers };
}

export async function publishDashboardDocument(content) {
  assertBackendConfigured();
  const document = await storeDashboardImages(content);
  const { data, error } = await supabase.rpc("publish_dashboard", { p_content: document });
  throwIfError(error);
  return { document, revisionId: data };
}
