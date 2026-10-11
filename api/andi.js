// Vercel entry point for POST /api/andi. Logic lives in server/andi.js (shared with Netlify).
// Other HTTP methods get a 405 from Vercel automatically.
import { handleAndi } from "../server/andi.js";

export function POST(request) {
  return handleAndi(request);
}
