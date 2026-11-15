import { Component, createRef, type ReactNode } from "react";
import { newArrivalIds } from "../lib/feed-arrivals";

type Props = { children: ReactNode; embedded: boolean; target: string | null; events: { id: string }[] };
type Anchor = { element: HTMLElement; top: number; root: HTMLElement | null };
type Snapshot = { anchor: Anchor | null; away: boolean };

/** Preserve the visible card when live arrivals or processing priority reorder
 * cards. A deliberate source-note link still owns its scrollIntoView behavior. */
export class FeedScrollAnchor extends Component<Props, { unseen: string[] }> {
  state = { unseen: [] as string[] };
  private root = createRef<HTMLDivElement>();
  private scrollRoot: HTMLElement | null = null;

  private getScrollRoot() {
    return this.props.embedded ? this.root.current?.closest<HTMLElement>("[data-inbox-scroll]") ?? null : null;
  }

  private resetAtTop = () => {
    if ((this.scrollRoot?.scrollTop ?? window.scrollY) <= 8 && this.state.unseen.length) {
      this.setState({ unseen: [] });
    }
  };

  componentDidMount() {
    this.scrollRoot = this.getScrollRoot();
    (this.scrollRoot ?? window).addEventListener("scroll", this.resetAtTop, { passive: true });
  }

  componentWillUnmount() {
    (this.scrollRoot ?? window).removeEventListener("scroll", this.resetAtTop);
  }

  getSnapshotBeforeUpdate(previous: Props): Snapshot | null {
    if (this.props.target !== previous.target) return null;
    const root = this.getScrollRoot();
    if ((root?.scrollTop ?? window.scrollY) <= 8) return { anchor: null, away: false };
    const top = root?.getBoundingClientRect().top ?? 0;
    const bottom = root?.getBoundingClientRect().bottom ?? window.innerHeight;
    // Cards are in vertical DOM order, including processing-priority cards.
    // A linear scan reads every preceding card in a long history.
    // Probe only O(log n) card positions instead.
    const cards = this.root.current?.getElementsByTagName("article");
    let low = 0;
    let high = cards?.length ?? 0;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (cards![middle].getBoundingClientRect().bottom <= top) low = middle + 1;
      else high = middle;
    }
    const candidate = cards?.[low];
    const element = candidate && candidate.getBoundingClientRect().top < bottom ? candidate : null;
    return { away: true, anchor: element ? { element, top: element.getBoundingClientRect().top, root } : null };
  }

  componentDidUpdate(previous: Props, _state: unknown, snapshot: Snapshot | null) {
    const anchor = snapshot?.anchor;
    if (anchor?.element.isConnected) {
      const delta = anchor.element.getBoundingClientRect().top - anchor.top;
      if (anchor.root) anchor.root.scrollTop += delta;
      else if (delta) window.scrollBy(0, delta);
    }
    if (previous.events === this.props.events) return;
    if (snapshot && !snapshot.away) {
      this.resetAtTop();
      return;
    }
    const arrivals = new Set(newArrivalIds(previous.events, this.props.events));
    if (!arrivals.size) return;
    const top = this.getScrollRoot()?.getBoundingClientRect().top ?? 0;
    const above = [...(this.root.current?.querySelectorAll<HTMLElement>("article[data-event-id]") ?? [])]
      .filter(card => arrivals.has(card.dataset.eventId!) && card.getBoundingClientRect().top < top)
      .map(card => card.dataset.eventId!);
    if (above.length) this.setState(state => ({ unseen: [...new Set([...state.unseen, ...above])] }));
  }

  private jumpToLatest = () => {
    const newest = this.props.events[0]?.id;
    const card = [...(this.root.current?.querySelectorAll<HTMLElement>("article[data-event-id]") ?? [])]
      .find(element => element.dataset.eventId === newest);
    if (!card) return;
    // Use the actual newest record, not the first priority-sorted processing job.
    // Move keyboard focus too, before removing the button that owned it.
    card.focus({ preventScroll: true });
    const root = this.getScrollRoot();
    if (root) root.scrollTo({ top: root.scrollTop + card.getBoundingClientRect().top - root.getBoundingClientRect().top, behavior: "instant" });
    else window.scrollTo({ top: window.scrollY + card.getBoundingClientRect().top, behavior: "instant" });
    this.setState({ unseen: [] });
  };

  private dismiss = () => {
    this.root.current?.focus({ preventScroll: true });
    this.setState({ unseen: [] });
  };

  render() {
    const count = this.state.unseen.length;
    const button = "rounded-md px-3 py-2 hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
    return (
      <div ref={this.root} tabIndex={-1} className="focus:outline-none">
        <div className={`sticky ${this.props.embedded ? "top-2" : "top-16 md:top-2"} z-10 h-0`}>
          {count > 0 && (
            <div className="absolute inset-x-0 top-0 mx-auto flex w-fit max-w-full flex-wrap items-center justify-center rounded-lg border border-border bg-card p-1 text-sm shadow-sm" data-testid="notice-new-messages">
              <button type="button" onClick={this.jumpToLatest} className={button} data-testid="button-jump-to-latest">
                {count} new {count === 1 ? "message" : "messages"} · Jump to latest
              </button>
              <button type="button" onClick={this.dismiss} className={`${button} text-muted-foreground`} aria-label="Dismiss new message notice" data-testid="button-dismiss-new-messages">Dismiss</button>
            </div>
          )}
        </div>
        <span role="status" aria-live="polite" aria-atomic="true" className="sr-only" data-testid="status-new-messages">
          {count ? `${count} new ${count === 1 ? "message has" : "messages have"} arrived above. Jump to latest or dismiss the notice.` : ""}
        </span>
        {this.props.children}
      </div>
    );
  }
}
