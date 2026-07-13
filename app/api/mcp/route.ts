import { createMcpHandler } from "@vercel/mcp-adapter";
import { z } from "zod";
import { getValidAccessToken } from "@/lib/schwab";

// This route reads env vars and hits KV/Schwab per-request, never at build time.
export const dynamic = "force-dynamic";

const SCHWAB_TRADER_BASE = "https://api.schwabapi.com/trader/v1";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

async function schwabGet(path: string, accessToken: string) {
  const res = await fetch(`${SCHWAB_TRADER_BASE}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    throw new Error(`Schwab API error ${res.status}: ${await res.text()}`);
  }

  return res.json();
}

const handler = createMcpHandler(async (server) => {
  server.tool(
    "get_open_orders",
    "Fetch currently open/working orders on the linked Schwab account",
    {
      status: z
        .enum([
          "WORKING",
          "PENDING_ACTIVATION",
          "QUEUED",
          "ACCEPTED",
          "ALL",
        ])
        .optional()
        .describe("Order status filter. Defaults to WORKING (open orders)."),
    },
    async ({ status }) => {
      const accessToken = await getValidAccessToken();
      const accountNumber = requireEnv("SCHWAB_ACCOUNT_NUMBER");

      const statusParam = status && status !== "ALL" ? `&status=${status}` : "";
      const orders = await schwabGet(
        `/accounts/${accountNumber}/orders?${statusParam.replace(/^&/, "")}`,
        accessToken
      );

      return {
        content: [{ type: "text", text: JSON.stringify(orders, null, 2) }],
      };
    }
  );

  server.tool(
    "get_account_positions",
    "Fetch current positions and balances on the linked Schwab account",
    {},
    async () => {
      const accessToken = await getValidAccessToken();
      const accountNumber = requireEnv("SCHWAB_ACCOUNT_NUMBER");

      const account = await schwabGet(
        `/accounts/${accountNumber}?fields=positions`,
        accessToken
      );

      return {
        content: [{ type: "text", text: JSON.stringify(account, null, 2) }],
      };
    }
  );
},
{
  // Optional server options (capabilities, etc.) -- none needed here.
},
{
  basePath: "/api",
});

export { handler as GET, handler as POST };
