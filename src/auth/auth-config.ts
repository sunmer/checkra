export const SUPABASE_PROJECT_ID   = 'wqtfvlozbxzerurmvgrc';
export const SUPABASE_URL          = `https://${SUPABASE_PROJECT_ID}.supabase.co`;
export const AUTH_BASE             = `${SUPABASE_URL}/auth/v1`;
export const REDIRECT_URI          = `${location.origin}/auth/callback`;   // must be whitelisted in Supabase UI
export const SESSION_KEY           = 'sb_session';                        // localStorage key 
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndxdGZ2bG96Ynh6ZXJ1cm12Z3JjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDc4NTMzNTEsImV4cCI6MjA2MzQyOTM1MX0.j0jM5hoTo-BGGxyQx32bXZiITQtmx8Fih1BsDy631i0'; 