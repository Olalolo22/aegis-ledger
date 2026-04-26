import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import type { Database } from "@/types/database";

/**
 * Creates a Supabase client for use in Server Components, API routes,
 * and Server Actions. Handles cookie-based session management via
 * the Next.js App Router cookie API.
 *
 * Usage:
 *   const supabase = await createClient();
 *   const { data } = await supabase.from('organizations').select('*');
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // setAll called from a Server Component — safe to ignore
            // if middleware is refreshing user sessions.
          }
        },
      },
    }
  );
}

/**
 * Creates a Supabase client with the service_role key for privileged
 * server-side operations (bypasses RLS). Use ONLY in API routes that
 * require elevated access (e.g., writing to viewing_keys).
 *
 * ⚠ NEVER expose this client or its key to the browser.
 */
export function createServiceClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}
