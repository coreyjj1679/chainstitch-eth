import { NextResponse } from "next/server";
import { getAuthContext } from "@/server/auth-context";
import { handleApiError } from "@/server/errors";
import { simulateNotebookOnFork } from "@/server/simulate-notebook";

type Params = { params: Promise<{ id: string }> };

/**
 * Stateful dry-run: spawn anvil --fork-url of the project's RPC, impersonate
 * writes, discard the fork. No keys. Viewer+.
 */
export async function POST(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const ctx = await getAuthContext(request.headers);
    const body = (await request.json().catch(() => ({}))) as {
      as?: unknown;
      timeoutMs?: unknown;
    };
    const result = await simulateNotebookOnFork(ctx, id, body);
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}
