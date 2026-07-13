export default function Home() {
  return (
    <main style={{ fontFamily: "sans-serif", padding: "2rem" }}>
      <h1>Cron Job Doctor MCP</h1>
      <p>
        Diagnoses scheduled GitHub Actions workflows: finds stuck jobs, timing
        drift, retry storms, and duration creep.
      </p>
      <p>
        MCP endpoint: <code>/api/mcp</code> — add as a custom connector in
        Claude / Cowork.
      </p>
    </main>
  );
}
