// Public (browser-safe) configuration. Only the URL and the publishable key may be NEXT_PUBLIC_.
// The secret/service-role key never appears in this app (docs/ARCHITECTURE.md).
// process.env.NEXT_PUBLIC_* must be referenced literally so Next can inline them.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`${name} is not set. Copy .env.example to .env.local and fill it in.`);
  }
  return value;
}

export function supabaseEnv() {
  return {
    url: required("NEXT_PUBLIC_SUPABASE_URL", url),
    publishableKey: required("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", publishableKey),
  };
}
