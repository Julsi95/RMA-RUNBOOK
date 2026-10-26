export async function functionErrorMessage(error) {
  if (error?.name !== "FunctionsHttpError" || typeof error.context?.clone !== "function") return "";

  const response = error.context;
  try {
    const body = await response.clone().json();
    const message = body?.error ?? body?.message;
    if (typeof message === "string" && message.trim()) return message.trim().slice(0, 500);
  } catch {
    // Fall through to a status-based message when the function did not return JSON.
  }

  return `The account function returned HTTP ${response.status}. Check the Supabase function logs for details.`;
}
