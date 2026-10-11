// Netlify entry point for POST /api/lead. Logic lives in server/lead.js (shared with Vercel).
import { handleLead } from "../../server/lead.js";

export default (req, context) => handleLead(req, context?.ip);

export const config = { path: "/api/lead" };
