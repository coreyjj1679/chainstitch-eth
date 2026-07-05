import { NextResponse } from "next/server";
import { getAuthContext } from "@/server/auth-context";
import { badRequest, handleApiError } from "@/server/errors";
import { lookupAbiForProject } from "@/server/abi-lookup";

type Params = { params: Promise<{ id: string }> };

/** Verified-ABI lookup for the address book (see server/abi-lookup.ts). */
export async function GET(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const ctx = await getAuthContext(request.headers);
    const url = new URL(request.url);
    const address = url.searchParams.get("address") ?? "";
    const rawChain = url.searchParams.get("chainId");
    let chainId: number | undefined;
    if (rawChain !== null) {
      chainId = Number(rawChain);
      if (Number.isNaN(chainId)) throw badRequest("chainId must be a number");
    }
    return NextResponse.json(await lookupAbiForProject(ctx, id, address, chainId));
  } catch (error) {
    return handleApiError(error);
  }
}
