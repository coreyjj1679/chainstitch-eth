import { handleMcpRequest } from "@/server/mcp";

/**
 * The MCP endpoint (Model Context Protocol, Streamable HTTP transport in
 * stateless JSON mode). Point a coding agent at http://localhost:3000/api/mcp.
 */
export async function POST(request: Request) {
  return handleMcpRequest(request);
}

/** No server-initiated streams (stateless server): GET is not offered. */
export async function GET() {
  return new Response(null, { status: 405, headers: { Allow: "POST" } });
}

/** No sessions to terminate (stateless server). */
export async function DELETE() {
  return new Response(null, { status: 405, headers: { Allow: "POST" } });
}
