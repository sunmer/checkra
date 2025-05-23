import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './auth-config';

/**
 * Supabase client instance.
 *
 * We are using the Supabase V2 library, which is the current standard.
 * It handles PKCE and token refresh automatically.
 *
 * Configuration options:
 * - autoRefreshToken: (default: true) Automatically refreshes the token when it expires.
 * - persistSession: (default: true) Persists the session in localStorage.
 * - detectSessionInUrl: (default: true) Automatically detects and handles sessions from URL fragments/query params
 *   (e.g., after OAuth redirect). This is crucial for the callback page.
 */
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    // Using default options which are generally fine:
    // autoRefreshToken: true,
    // persistSession: true,
    // detectSessionInUrl: true
  }
}); 