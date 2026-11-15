import "./_group.css";
import { EventCard, Shell, seededItems, seededMessages } from "./_shared";

// Baseline extracted from ring-inbox/src/pages/inbox.tsx's populated branch.
// Original sidebar (no Dashboard addition), Inbox selected, source spacing.
export function Current() {
  return (
    <Shell active="inbox" originalSidebar>
      <div>
        <div className="space-y-3">
          {seededMessages.map((e) => <EventCard key={e.id} e={e} items={seededItems.filter((i) => i.sourceEventId === e.id)} highlight={false} />)}
        </div>
      </div>
    </Shell>
  );
}
