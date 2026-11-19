export async function testingVoiceRequest<T>(url: string, body?: object | FormData, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store",
    credentials: "same-origin",
    signal,
    ...(body instanceof FormData
      ? { method: "POST", body }
      : body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) throw Error(data.error || `Request failed (${response.status}).`);
  return data;
}
