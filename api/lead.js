// Vercel entry point for POST /api/lead. Logic lives in server/lead.js (shared with Netlify).
// Other HTTP methods get a 405 from Vercel automatically.
import { handleLead } from "../server/lead.js";

// Vercel sets x-real-ip to the visitor's address; used for the optional Turnstile check.
export function POST(request) {
  const ip = request.headers.get("x-real-ip") || (request.headers.get("x-forwarded-for") || "").split(",")[0].trim();
  return handleLead(request, ip || undefined);
}
