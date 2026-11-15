import { Component, createRef, type ReactNode } from "react";

type Props = { children: ReactNode; embedded: boolean; target: string | null };
type Anchor = { element: HTMLElement; top: number; root: HTMLElement | null };

/** Preserve the visible card when live arrivals or processing priority reorder
 * cards. A deliberate source-note link still owns its scrollIntoView behavior. */
export class FeedScrollAnchor extends Component<Props> {
  private root = createRef<HTMLDivElement>();

  getSnapshotBeforeUpdate(previous: Props): Anchor | null {
    if (this.props.target !== previous.target) return null;
    const root = this.props.embedded ? this.root.current?.closest<HTMLElement>("[data-inbox-scroll]") ?? null : null;
    if ((root?.scrollTop ?? window.scrollY) < 8) return null;
    const top = root?.getBoundingClientRect().top ?? 0;
    const bottom = root?.getBoundingClientRect().bottom ?? window.innerHeight;
    const element = [...(this.root.current?.querySelectorAll<HTMLElement>("article") ?? [])]
      .find(card => { const rect = card.getBoundingClientRect(); return rect.bottom > top && rect.top < bottom; });
    return element ? { element, top: element.getBoundingClientRect().top, root } : null;
  }

  componentDidUpdate(_previous: Props, _state: unknown, anchor: Anchor | null) {
    if (!anchor?.element.isConnected) return;
    const delta = anchor.element.getBoundingClientRect().top - anchor.top;
    if (anchor.root) anchor.root.scrollTop += delta;
    else if (delta) window.scrollBy(0, delta);
  }

  render() {
    return <div ref={this.root}>{this.props.children}</div>;
  }
}
