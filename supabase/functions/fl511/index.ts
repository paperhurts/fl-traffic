// Supabase Edge Function: FL511's live events (and the page's TomTom key) for
// the traffic map. Deploy without JWT checks; the map calls it with no key:
//   supabase functions deploy fl511 --no-verify-jwt
// Secrets: TOMTOM_KEY (optional), ALLOWED_ORIGINS (comma-separated, optional).

import { createRelay } from "./relay.ts";

const relay = createRelay(Deno.env);

Deno.serve(relay.handle);
