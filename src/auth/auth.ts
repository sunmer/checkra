import { supabase } from './supabaseClient';
import { REDIRECT_URI } from './auth-config'; // Keep REDIRECT_URI for explicit passing
import { customLog, customWarn, customError } from '../utils/logger';
// The supabase-js library will handle session storage internally, so SESSION_KEY is no longer needed here.
// SUPABASE_ANON_KEY and SUPABASE_PROJECT_ID are used in supabaseClient.ts, not directly here.

//-----------------------------------------------------------------
// 1. HELPER – PKCE (No longer needed)
//-----------------------------------------------------------------
// The supabase-js client handles PKCE internally when you use OAuth.
// The pkcePair function can be removed.

//-----------------------------------------------------------------
// 2. LOGIN FLOW
//-----------------------------------------------------------------

// STEP-1  – Call on "Log in" button click
export async function startLogin(provider: 'google' | 'github' /* add more as needed */ = 'google'): Promise<void> {
  customLog(`[Auth] Attempting to sign in with ${provider} via Supabase client...`);
  const { error } = await supabase.auth.signInWithOAuth({
    provider: provider,
    options: {
      redirectTo: REDIRECT_URI, // This is where Supabase redirects after external auth
      // scopes: 'openid profile email', // Optional: request specific scopes for Google
    },
  });

  if (error) {
    customError(`[Auth] Error starting ${provider} OAuth flow:`, error);
    // Potentially throw error or show a user-facing message
    // For now, just logging.
  }
  // If no error, the browser will be redirected by Supabase to the provider's login page.
  // No need for manual location.href change.
}

// STEP-2 – No longer explicitly needed here for token exchange.
// The Supabase client, when initialized on the callback page,
// will automatically handle the code exchange if `detectSessionInUrl` is true (default).
// We will need to ensure the callback page initializes the Supabase client.
// The `finishLogin` function as previously defined can be removed.
// However, the callback page might want to know if login succeeded.
// We can create a new function or use onAuthStateChange for this.

/**
 * This function can be called on the callback page to signal completion
 * or to retrieve the session. Supabase client handles the exchange itself.
 */
export async function handleAuthCallback(): Promise<boolean> {
  // Supabase client (if detectSessionInUrl is true) should have already processed
  // the URL and exchanged the code for a session by the time this function is called.
  // We can check if a session now exists.
  const { data: { session }, error } = await supabase.auth.getSession();

  if (error) {
    customError('[Auth] Error getting session after callback:', error);
    return false;
  }

  if (session) {
    customLog('[Auth] Session successfully established after callback:', session);
    // Optionally, store additional user profile data if needed here
    // For example, by calling supabase.from('profiles').upsert(...)
    return true;
  } else {
    customWarn('[Auth] No session found after callback. This might happen if the URL was already processed or there was an issue.');
    return false;
  }
}

//-----------------------------------------------------------------
// 3. SESSION MANAGEMENT + REFRESH (Simplified by Supabase client)
//-----------------------------------------------------------------
// TokenResp and Stored interfaces are no longer needed as Supabase manages session object internally.
// storeSession and loadSession are no longer needed.

export async function logout(): Promise<void> {
  customLog('[Auth] Attempting to sign out via Supabase client...');
  const { error } = await supabase.auth.signOut();
  if (error) {
    customError('[Auth] Error signing out:', error);
    throw error; // Re-throw to be caught by the caller and for consistent error handling
  }
  customLog('[Auth] User signed out. Reloading page...');
  window.location.reload(); // Automatically reload the page
}

// Get current valid JWT or null. Supabase client handles refresh.
export async function getToken(): Promise<string | null> {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error) {
    customError('[Auth] Error getting current session/token:', error);
    return null;
  }
  if (session) {
  
    return session.access_token;
  }

  return null;
}

//-----------------------------------------------------------------
// 4. AUTH HEADER HELPER (Remains largely the same concept)
//-----------------------------------------------------------------
export async function authHeader(): Promise<Record<string, string>> {
  const token = await getToken();
  return token ? { 'Authorization': `Bearer ${token}` } : {};
}

// Custom error for authentication requirement (can be kept if used)
export class AuthenticationRequiredError extends Error {
  loginUrl?: string;
  constructor(message: string, loginUrl?: string) {
    super(message);
    this.name = "AuthenticationRequiredError";
    this.loginUrl = loginUrl;
  }
}

//-----------------------------------------------------------------
// 5. ENDPOINT CONTRACT (fetchProtected helper - can be kept or adapted)
//-----------------------------------------------------------------
export async function fetchProtected(url: string, init: RequestInit = {}): Promise<Response> {
  const headersWithAuth = { ...(init.headers || {}), ...(await authHeader()) };
  const response = await fetch(url, { ...init, headers: headersWithAuth });

  if (response.status === 401) {
    customWarn('[Auth] fetchProtected received 401 Unauthenticated for URL:', url);
    // Potentially trigger logout or a global unauthenticated event
    // await logout(); // Example: force logout on 401
    // Re-throw a specific error that UI can catch to redirect to login
    throw new AuthenticationRequiredError('Request resulted in 401 - Authentication required.');
  }
  return response;
}

//-----------------------------------------------------------------
// 7. OPTIONAL UTILITIES (Adapted for Supabase client)
//-----------------------------------------------------------------

// Quick check if user is logged in
export async function isLoggedIn(): Promise<boolean> {
  const { data: { session } } = await supabase.auth.getSession();
  return !!session;
}

// Parse current user id (sub) from JWT or session
export async function currentUserId(): Promise<string | null> {
  // Use asynchronous getUser() for robustness, as session might not be loaded yet.
  const { data: { user }, error } = await supabase.auth.getUser();

  if (error) {
    customError("[Auth] Error fetching user for currentUserId:", error);
    return null;
  }
  
  if (user) {
    return user.id;
  }
  
  customWarn('[Auth] currentUserId: No active user found through supabase.auth.getUser().');
  return null; 
}

// Optional: Expose a way to listen to auth state changes directly
// This is very useful for UI updates.
export function onAuthStateChange(callback: (event: string, session: import('@supabase/supabase-js').Session | null) => void) {
  return supabase.auth.onAuthStateChange(callback);
}
