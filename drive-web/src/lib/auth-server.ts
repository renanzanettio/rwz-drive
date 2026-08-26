import { cookies } from "next/headers";
import { API_INTERNAL_URL } from "./config";

export interface CurrentUser {
  id: string;
  username: string;
  email: string | null;
  role: "admin" | "user";
}

/**
 * Usado apenas em Server Components (ex.: layout do /drive) para decidir se
 * redireciona para /login. Fala direto com a API interna (não passa pelo
 * proxy, pois estamos no próprio servidor).
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const cookieHeader = cookies().toString();
  if (!cookieHeader) return null;

  try {
    const res = await fetch(`${API_INTERNAL_URL}/api/auth/me`, {
      headers: { cookie: cookieHeader },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as CurrentUser;
  } catch {
    return null;
  }
}
