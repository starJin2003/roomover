"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { Switch } from "@/components/ui/switch";

interface UnderTheHoodState {
  on: boolean;
  setOn: (on: boolean) => void;
}

const UnderTheHoodContext = createContext<UnderTheHoodState>({ on: false, setOn: () => undefined });

/**
 * Wraps one panel. Off by default, so students read everyday words. On shows the
 * PayPal API name and sandbox ID under every PayPal step, which the demo
 * video turns on for judges.
 */
export function UnderTheHoodProvider({ defaultOn = false, children }: { defaultOn?: boolean; children: ReactNode }) {
  const [on, setOn] = useState(defaultOn);
  const value = useMemo(() => ({ on, setOn }), [on]);
  return <UnderTheHoodContext.Provider value={value}>{children}</UnderTheHoodContext.Provider>;
}

export function useUnderTheHood(): boolean {
  return useContext(UnderTheHoodContext).on;
}

export function UnderTheHoodSwitch() {
  const { on, setOn } = useContext(UnderTheHoodContext);
  return <Switch label="Under the hood" checked={on} onCheckedChange={setOn} />;
}
