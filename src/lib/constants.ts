/**
 * Supabase configuration — uses the same project as the Vetidia web app.
 * The anon key is safe to embed in client code as long as RLS is enabled.
 */
export const SUPABASE_URL = "https://jvkvfuohixdajphtkhrz.supabase.co";
export const SUPABASE_ANON_KEY = import.meta.env
  .WXT_SUPABASE_ANON_KEY as string;
