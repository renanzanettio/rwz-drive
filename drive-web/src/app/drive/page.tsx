import { getCurrentUser } from "@/lib/auth-server";
import { DriveApp } from "@/components/DriveApp";

export default async function DrivePage() {
  const user = await getCurrentUser();
  // O layout já garante que user existe aqui; checagem só para o TypeScript.
  if (!user) return null;
  return <DriveApp user={user} />;
}
