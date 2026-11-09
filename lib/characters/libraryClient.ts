/** Read-only retry for a transient proxy, connection or non-JSON response. */
export async function loadSavedCharacters(signal: AbortSignal, fetcher: typeof fetch = fetch) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const query = new URLSearchParams({library: "1", refresh: String(Date.now())});
      const response = await fetcher(`/api/characters?${query}`, {
        cache: "no-store",
        credentials: "include",
        headers: {Accept: "application/json"},
        signal,
      });
      if (response.status === 401) throw new CharacterLibrarySessionError();
      const data = await response.json().catch(() => null);
      if (response.ok && data?.ok && Array.isArray(data.items)) return data.items;
      if (attempt === 0 && (!data || response.status >= 500)) continue;
      throw new Error(data?.error || "Could not load saved characters. Please refresh to reconnect.");
    } catch (error) {
      if (signal.aborted || error instanceof CharacterLibrarySessionError || attempt === 1) throw error;
    }
  }
  throw new Error("Could not load saved characters. Please refresh to reconnect.");
}
class CharacterLibrarySessionError extends Error {
  constructor() { super("Sign in again to load your saved characters."); }
}
