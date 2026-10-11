// Netlify entry point for POST /api/andi. Logic lives in server/andi.js (shared with Vercel).
import { handleAndi } from "../../server/andi.js";

export default (req) => handleAndi(req);

export const config = { path: "/api/andi" };
