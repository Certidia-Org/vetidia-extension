import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./constants";

/**
 * Custom storage adapter that wraps `chrome.storage.local`.
 * Required because Manifest V3 service workers have no access to localStorage.
 */
const chromeStorageAdapter = {
  async getItem(key: string): Promise<string | null> {
    const result = await chrome.storage.local.get(key);
    return (result[key] as string) ?? null;
  },
  async setItem(key: string, value: string): Promise<void> {
    await chrome.storage.local.set({ [key]: value });
  },
  async removeItem(key: string): Promise<void> {
    await chrome.storage.local.remove(key);
  },
};

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        storage: chromeStorageAdapter,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false, // important: disable for extensions
      },
    });
  }
  return client;
}
