import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ViewKey } from "@/types";

interface ViewKeyState {
  viewKeys: ViewKey[];
  addViewKey: (key: ViewKey) => void;
  revokeViewKey: (id: string) => void;
  setViewKeys: (keys: ViewKey[]) => void;
}

export const useViewKeyStore = create<ViewKeyState>()(
  persist(
    (set) => ({
      viewKeys: [],
      addViewKey: (key) =>
        set((state) => ({ viewKeys: [...state.viewKeys, key] })),
      revokeViewKey: (id) =>
        set((state) => ({
          viewKeys: state.viewKeys.map((k) =>
            k.id === id
              ? { ...k, isActive: false, revokedAt: new Date().toISOString() }
              : k
          ),
        })),
      setViewKeys: (keys) => set({ viewKeys: keys }),
    }),
    { name: "paymage-view-keys-v2" },
  ),
);
