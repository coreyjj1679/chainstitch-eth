"use client";

import { createAuthClient } from "better-auth/react";
import { siweClient } from "better-auth/client/plugins";

/** Better Auth browser client (same-origin base URL). */
export const authClient = createAuthClient({
  plugins: [siweClient()],
});
