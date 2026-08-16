import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { openSession, SESSION_COOKIE, type Session } from "../../src/auth/session.ts";

/** The dashboard is auth-only: no valid session cookie means sign-in. */
export async function requireSession(): Promise<Session> {
  const store = await cookies();
  const raw = store.get(SESSION_COOKIE)?.value;
  const session = raw ? openSession(raw) : null;
  if (!session) redirect("/api/auth/login");
  return session;
}
