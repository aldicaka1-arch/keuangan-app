import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !key) {
  console.error(
    "Supabase belum dikonfigurasi: set VITE_SUPABASE_URL dan VITE_SUPABASE_ANON_KEY di .env.local"
  );
}

export const supabase = createClient(url, key, {
  auth: { detectSessionInUrl: true },
});
export const BUCKET = "keuangan-foto";

/** Parse #error=… from email confirmation redirect; clears hash from URL. */
export function consumeAuthHashError() {
  const raw = window.location.hash.replace(/^#/, "");
  if (!raw || !raw.includes("error=")) return null;
  const params = new URLSearchParams(raw);
  const code = params.get("error_code");
  const desc = params.get("error_description");
  window.history.replaceState(null, "", window.location.pathname + window.location.search);
  if (code === "otp_expired") return "otp_expired";
  return desc ? decodeURIComponent(desc.replace(/\+/g, " ")) : code;
}