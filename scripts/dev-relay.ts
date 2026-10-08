// Serves the FL511 relay locally, for the dev server before (or instead of) the
// deployed Edge Function:
//   npm run relay          then, in .env.local:  VITE_RELAY_URL=http://localhost:5291/fl511
// TOMTOM_KEY in the environment is handed to the page the way the deployed relay would.

import { createServer } from "node:http";
import { createRelay } from "../supabase/functions/fl511/relay.ts";

const port = Number(process.env.PORT ?? 5291);
const relay = createRelay({ get: (name) => process.env[name] });

createServer(async (req, res) => {
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
  const answer = await relay.handle(new Request(`http://localhost:${port}${req.url}`, { method: req.method, headers }));
  res.writeHead(answer.status, Object.fromEntries(answer.headers));
  res.end(Buffer.from(await answer.arrayBuffer()));
}).listen(port, () => console.log(`FL511 relay on http://localhost:${port}/fl511`));
