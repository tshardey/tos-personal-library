import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { getMyHousehold } from "@/lib/household-repo";
import type { Household, HouseholdMember } from "@/lib/types";

interface HouseholdContextValue {
  household: Household | null;
  members: HouseholdMember[];
  loading: boolean;
  refresh(): Promise<void>;
}

const HouseholdContext = createContext<HouseholdContextValue | null>(null);

export function HouseholdProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [household, setHousehold] = useState<Household | null>(null);
  const [members, setMembers] = useState<HouseholdMember[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!userId) {
      setHousehold(null);
      setMembers([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const result = await getMyHousehold();
      setHousehold(result?.household ?? null);
      setMembers(result?.members ?? []);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void refresh().catch(() => {});
  }, [refresh]);

  const value = useMemo(
    () => ({ household, members, loading, refresh }),
    [household, members, loading, refresh],
  );
  return <HouseholdContext.Provider value={value}>{children}</HouseholdContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useHousehold(): HouseholdContextValue {
  const ctx = useContext(HouseholdContext);
  if (!ctx) throw new Error("useHousehold must be used within HouseholdProvider");
  return ctx;
}
