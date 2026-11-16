import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { getMyHousehold } from "@/lib/household-repo";
import { saveLastEmail } from "@/lib/last-email";
import type { Household, HouseholdMember } from "@/lib/types";

interface HouseholdContextValue {
  household: Household | null;
  members: HouseholdMember[];
  loading: boolean;
  error: string | null;
  refresh(): Promise<void>;
}

const HouseholdContext = createContext<HouseholdContextValue | null>(null);

export function HouseholdProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const userEmail = user?.email ?? null;
  const [household, setHousehold] = useState<Household | null>(null);
  const [members, setMembers] = useState<HouseholdMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!userId) {
      setHousehold(null);
      setMembers([]);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await getMyHousehold();
      setHousehold(result?.household ?? null);
      setMembers(result?.members ?? []);
      // The sign-in box suggests this address after a sign-out, so a return lands in this library.
      if (result?.household && userEmail) saveLastEmail(userEmail);
    } catch (err) {
      console.error("Failed to load household", err);
      setError("Couldn't load your household.");
    } finally {
      setLoading(false);
    }
  }, [userId, userEmail]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo(
    () => ({ household, members, loading, error, refresh }),
    [household, members, loading, error, refresh],
  );
  return <HouseholdContext.Provider value={value}>{children}</HouseholdContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useHousehold(): HouseholdContextValue {
  const ctx = useContext(HouseholdContext);
  if (!ctx) throw new Error("useHousehold must be used within HouseholdProvider");
  return ctx;
}
