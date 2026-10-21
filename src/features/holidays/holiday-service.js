import { requireSupabase } from "@/lib/supabase";

export async function loadHolidayCalendar(year) {
  const { data, error } = await requireSupabase().from("holiday_calendar").select("id,country_code,holiday_date,name,name_override,source,api_is_working,is_working_override,is_working")
    .gte("holiday_date", `${year}-01-01`).lt("holiday_date", `${year + 1}-01-01`)
    .eq("is_active", true).is("deleted_at", null).order("holiday_date").order("country_code").order("name");
  if (error) throw error;
  return data ?? [];
}

export async function syncHolidayYear(country, year, force = false) {
  const { data, error } = await requireSupabase().functions.invoke("sync-holidays", { body: { country, year, force } });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function saveHoliday({ id = null, country, date, name, isWorking }) {
  const { data, error } = await requireSupabase().rpc("save_holiday", {
    p_id: id, p_country: country, p_date: date, p_name: name.trim(), p_is_working: isWorking,
  });
  if (error) throw error;
  return data;
}

export async function deleteHoliday(id) {
  const { error } = await requireSupabase().rpc("delete_holiday", { p_id: id });
  if (error) throw error;
}
