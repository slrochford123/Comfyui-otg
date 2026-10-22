export function uiStatusTone(message: string): "error" | "success" | "warning" | "info" {
  if (/\b(error|failed|failure|unable|cannot|invalid|denied|unavailable|disconnected)\b|not signed in|\bnot (ready|available|connected|completed|saved)\b/i.test(message)) return "error";
  if (/\b(cancel|cancelling|canceling|stopping|busy|waiting|restarting)\b/i.test(message)) return "warning";
  if (/\b(connected|verified|saved|completed|success|restored|cleared|ready|deleted|answered)\b/i.test(message)) return "success";
  return "info";
}
