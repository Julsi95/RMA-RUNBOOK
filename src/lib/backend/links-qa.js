import { assertBackendConfigured, throwIfError } from "./shared.js";
import { supabase } from "@/lib/supabase";

export async function loadAppLinks({ publicOnly = false } = {}) {
  assertBackendConfigured();
  if (publicOnly) {
    const { data, error } = await supabase.rpc("get_public_app_links");
    throwIfError(error);
    return (data ?? []).map((row) => ({ ...row, group: row.group_name, publicVisible: true }));
  }
  const { data, error } = await supabase.from("app_links").select("id,name,url,application,group_name,description,sort_order,is_public").order("sort_order");
  throwIfError(error);
  return (data ?? []).map((row) => ({ ...row, group: row.group_name, publicVisible: Boolean(row.is_public) }));
}

export async function saveAppLinks(items) {
  assertBackendConfigured();
  const { error } = await supabase.rpc("save_app_links", { p_items: items.map((item) => ({
    id: item.id, name: item.name, url: item.url ?? "", application: item.application ?? "",
    group: item.group ?? item.group_name ?? "General", description: item.description ?? "", publicVisible: Boolean(item.publicVisible),
  })) });
  throwIfError(error);
}

export async function loadQaCriteria() {
  assertBackendConfigured();
  const { data, error } = await supabase.from("qa_criteria").select("id,category,criterion,tcr,tcp,sort_order").order("sort_order");
  throwIfError(error);
  return (data ?? []).map((row) => ({ ...row, order: row.sort_order }));
}

export async function saveQaCriteria(items) {
  assertBackendConfigured();
  const { error } = await supabase.rpc("save_qa_criteria", { p_items: items.map((item, index) => ({
    id: item.id, category: item.category ?? "General", criterion: item.criterion,
    tcr: Number(item.tcr), tcp: Number(item.tcp), order: item.order ?? index,
  })) });
  throwIfError(error);
}
