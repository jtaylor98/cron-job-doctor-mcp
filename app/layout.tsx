export const metadata = {
  title: "Schwab MCP Server",
  description: "Remote MCP server exposing Schwab account tools to Claude",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
