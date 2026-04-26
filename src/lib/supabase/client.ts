import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/types/database";

/**
 * Creates a Supabase client for use in Client Components (browser-side).
 * Uses the public anon key — all queries are subject to RLS policies.
 *
 * Usage:
 *   const supabase = createClient();
 *   const { data } = await supabase.from('organizations').select('*');
 */
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
