"use client";

import { AuthScreen } from "@/components/AuthScreen";
import { VaultScreen } from "@/components/VaultScreen";
import { useSession } from "@/lib/session";

export default function Page() {
  const { account } = useSession();
  return account ? <VaultScreen /> : <AuthScreen />;
}
