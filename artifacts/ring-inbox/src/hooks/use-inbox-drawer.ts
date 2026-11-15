import { createContext, useContext } from "react";

export const InboxDrawerContext = createContext<{ openInbox: (noteId?: string) => void } | null>(null);
export function useInboxDrawer() {
  const value = useContext(InboxDrawerContext);
  if (!value) throw new Error("Inbox drawer requires the signed-in shell");
  return value;
}
