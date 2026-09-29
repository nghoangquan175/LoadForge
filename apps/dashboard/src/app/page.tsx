import { connection } from "next/server";
import { Dashboard } from "@/components/dashboard";
import { authMode } from "@/lib/auth";

export default async function Home() {
  // Auth env is set at runtime on the server, not at build time.
  await connection();
  return <Dashboard canLogout={authMode().mode === "enabled"} />;
}
