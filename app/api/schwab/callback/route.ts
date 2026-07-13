import { NextRequest, NextResponse } from "next/server";
import { exchangeCodeForTokens } from "@/lib/schwab";

// This route reads env vars and hits KV/Schwab per-request, never at build time.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");

  if (!code) {
    return NextResponse.json(
      { error: "Missing 'code' query param. Did Schwab redirect here directly?" },
      { status: 400 }
    );
  }

  try {
    // Schwab sends the code URL-encoded; Next.js already decodes searchParams for us.
    await exchangeCodeForTokens(code);
    return NextResponse.json({
      status: "ok",
      message:
        "Schwab account linked successfully. Tokens are stored and will auto-refresh. You can close this tab.",
    });
  } catch (err) {
    return NextResponse.json(
      { status: "error", message: (err as Error).message },
      { status: 500 }
    );
  }
}
