import { createContext, useContext, type ReactNode } from 'react';

const ScreenPortal = createContext<HTMLElement | null>(null);
export const useScreenPortal = () => useContext(ScreenPortal);

export function ScreenPortalProvider({
  container,
  children,
}: {
  container: HTMLElement | null;
  children: ReactNode;
}) {
  return <ScreenPortal.Provider value={container}>{children}</ScreenPortal.Provider>;
}
