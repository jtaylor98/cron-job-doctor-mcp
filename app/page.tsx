export default function Home() {
  return (
    <main style={{ fontFamily: "sans-serif", padding: "2rem" }}>
      <h1>Schwab MCP Server</h1>
      <p>
        This deployment exposes an MCP endpoint at <code>/api/mcp</code> for
        use as a custom connector in Claude / Cowork.
      </p>
      <p>
        First-time setup: visit <code>/api/schwab/authorize</code> once to
        link your Schwab account.
      </p>
    </main>
  );
}
