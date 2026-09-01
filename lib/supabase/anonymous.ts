import { createClient } from "./client";

/**
 * Ensures this browser has a persisted anonymous Supabase session before it
 * makes a request to an authenticated application route.
 */
export async function ensureAnonymousSession(): Promise<string> {
  const supabase = createClient();
  const { data: current, error: currentError } = await supabase.auth.getSession();
  if (currentError) throw currentError;

  if (!current.session?.user) {
    const { data, error } = await supabase.auth.signInAnonymously();
    if (error) throw error;
    if (!data.session?.user) throw new Error("ANONYMOUS_SESSION_MISSING");
  }

  // This confirms the browser client has a real persisted session and user ID
  // before same-origin API requests rely on its auth cookies.
  const { data: verified, error: verifiedError } = await supabase.auth.getSession();
  if (verifiedError) throw verifiedError;
  if (!verified.session?.user) throw new Error("ANONYMOUS_SESSION_MISSING");
  return verified.session.user.id;
}

/**
 * Leaves the current browser-only guest identity and starts a new one. This
 * intentionally does not delete the old account or any games it belongs to.
 */
export async function startFreshAnonymousSession(): Promise<string> {
  const supabase = createClient();
  const { error } = await supabase.auth.signOut({ scope: "local" });
  if (error) throw error;
  return ensureAnonymousSession();
}
