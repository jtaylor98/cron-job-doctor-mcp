import { NextResponse } from "next/server";
import { buildAuthorizeUrl } from "@/lib/schwab";

// This route reads env vars and must run per-request, never at build time.
export const dynamic = "force-dynamic";

// Visit this route once in a browser (while logged into your Schwab account)
// to grant this app access. Schwab will redirect back to /api/schwab/callback.
export async function GET() {
  return NextResponse.redirect(buildAuthorizeUrl());
}
