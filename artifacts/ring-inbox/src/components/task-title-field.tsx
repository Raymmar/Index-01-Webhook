import { useLayoutEffect, useRef, type ComponentProps } from "react";

// Keep the caller's existing input styling, including its one-line minimum.
export function TaskTitleField({ value, style, ...props }: ComponentProps<"textarea">) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const resize = () => {
      const computed = getComputedStyle(node);
      // Avoid collapsing the live field (and moving the page/caret) to measure.
      const measure = node.cloneNode() as HTMLTextAreaElement;
      measure.removeAttribute("id");
      measure.removeAttribute("data-testid");
      measure.setAttribute("aria-hidden", "true");
      measure.tabIndex = -1;
      Object.assign(measure.style, { position: "fixed", visibility: "hidden", pointerEvents: "none", height: "0px", minHeight: "0px", maxHeight: "none", width: `${node.getBoundingClientRect().width}px` });
      measure.value = node.value || node.placeholder || " ";
      node.parentElement!.appendChild(measure);
      const measured = measure.scrollHeight;
      measure.remove();
      node.style.height = `${Math.ceil(measured + parseFloat(computed.borderTopWidth) + parseFloat(computed.borderBottomWidth))}px`;
    };
    resize();
    let width = node.getBoundingClientRect().width;
    const observer = new ResizeObserver(() => {
      const next = node.getBoundingClientRect().width;
      if (next !== width) { width = next; resize(); }
    });
    observer.observe(node);
    let active = true;
    void document.fonts.ready.then(() => { if (active) resize(); });
    document.fonts.addEventListener("loadingdone", resize);
    return () => { active = false; observer.disconnect(); document.fonts.removeEventListener("loadingdone", resize); };
  }, [value]);
  return <textarea {...props} value={value} ref={ref} rows={1}
    style={{ ...style, boxSizing: "border-box", resize: "none", overflow: "hidden", display: "block" }} />;
}
