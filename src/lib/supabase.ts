import { createClient } from "@supabase/supabase-js";

// Helper to safely access env vars in various environments (Vite, etc)
const getEnv = (key: string) => {
  try {
    // @ts-ignore
    return import.meta.env?.[key] || process.env?.[key] || "";
  } catch {
    return "";
  }
};

const supabaseUrl = getEnv("VITE_SUPABASE_URL");
const supabaseAnonKey = getEnv("VITE_SUPABASE_ANON_KEY");

// Prevent crash if env vars are missing. 
// createClient throws if URL is missing, so we provide a placeholder.
// API calls will fail gracefully later if this placeholder is used.
const urlToUse = supabaseUrl && supabaseUrl.length > 0 ? supabaseUrl : "https://placeholder.supabase.co";
const keyToUse = supabaseAnonKey && supabaseAnonKey.length > 0 ? supabaseAnonKey : "placeholder-key";

export const supabase = createClient(urlToUse, keyToUse);