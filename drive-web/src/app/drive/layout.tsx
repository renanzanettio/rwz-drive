import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth-server";

export default async function DriveLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }
  return <>{children}</>;
}
