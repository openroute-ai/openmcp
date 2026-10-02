import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import type { UserWithRole } from "@/server/routers";
import type { PlatformRole } from "@/server/routers/trpc";
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
  // 只放行已知角色：DB 里出现别的值时降级为 undefined（按普通用户处理），
  // 而不是把任意字符串当作 role 往下传。super_admin 必须在这里显式放行，
  // 否则它会在 session 归一化时被抹掉、进而被 adminProcedure 挡下。
  const role = (authSession.user as { role?: unknown }).role;
  const user = {
    ...authSession.user,
    role:
      role === "admin" || role === "super_admin" || role === "user"
        ? (role as PlatformRole)
        : undefined,
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
