export const metadata = {
  title: "Cron Job Doctor MCP",
  description: "Remote MCP server that diagnoses scheduled GitHub Actions workflows",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
