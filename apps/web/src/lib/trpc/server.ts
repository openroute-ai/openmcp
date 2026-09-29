import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import type { UserWithRole } from "@/server/routers";
import {
  appRouter,
  createCallerFactory,
  createTRPCContext,
} from "@/server/routers";

/**
 * Resolves the better-auth session for a set of headers and normalises the
 * `role` field, which better-auth types as a plain string.
 */
const resolveSession = async (headers: Headers) => {
  const authSession = await auth.api.getSession({ headers });
  if (!authSession?.user) {
    return { user: null, session: null };
  }
  const role = (authSession.user as { role?: unknown }).role;
  const user = {
    ...authSession.user,
    role:
      role === "admin" || role === "user" ? (role as "admin" | "user") : undefined,
  } as UserWithRole;
  return { user, session: authSession.session ?? null };
};

/**
 * Creates a server-side caller for use in server components and server
 * actions, so routers can be invoked directly without an HTTP round trip.
 */
export const createServerCaller = async () => {
  const headersList = await headers();

  return createCallerFactory(appRouter)(
    await createTRPCContext({
      headers: headersList,
      ...(await resolveSession(headersList)),
    })
  );
};

/**
 * Context factory for the fetch adapter at `/api/trpc`.
 */
export const createContextFromRequest = async (req: Request) => {
  const requestHeaders = new Headers(req.headers);

  return createTRPCContext({
    headers: requestHeaders,
    req,
    ...(await resolveSession(requestHeaders)),
  });
};
