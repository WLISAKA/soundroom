import { useLayoutEffect, useMemo, useState, type RefObject } from "react";

export function useVirtualList<T>(
  items: T[],
  viewportRef: RefObject<HTMLElement | null>,
  contentRef: RefObject<HTMLElement | null>,
  key: string,
  rowHeight: number,
  headerHeight = 0,
) {
  const [range, setRange] = useState({ start: 0, end: 40 });
  const enabled = items.length > 200;
  useLayoutEffect(() => {
    const viewport = viewportRef.current,
      content = contentRef.current;
    if (!enabled || !viewport || !content) return;
    let frame = 0;
    const update = () => {
      const top = Math.max(
        0,
        viewport.getBoundingClientRect().top -
          content.getBoundingClientRect().top -
          headerHeight,
      );
      const first = Math.floor(top / rowHeight);
      const start = Math.max(0, Math.min(first - 8, items.length - 1));
      const end = Math.min(
        items.length,
        first + Math.ceil(viewport.clientHeight / rowHeight) + 9,
      );
      setRange((previous) =>
        previous.start === start && previous.end === end
          ? previous
          : { start, end },
      );
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    update();
    viewport.addEventListener("scroll", schedule, { passive: true });
    const observer = new ResizeObserver(schedule);
    observer.observe(viewport);
    return () => {
      cancelAnimationFrame(frame);
      viewport.removeEventListener("scroll", schedule);
      observer.disconnect();
    };
  }, [
    enabled,
    items.length,
    key,
    rowHeight,
    headerHeight,
    viewportRef,
    contentRef,
  ]);
  const start = enabled
    ? Math.min(range.start, Math.max(0, items.length - 1))
    : 0;
  const end = enabled
    ? Math.min(items.length, Math.max(start + 1, range.end))
    : items.length;
  const visible = useMemo(() => items.slice(start, end), [items, start, end]);
  return {
    visible,
    start,
    before: start * rowHeight,
    after: (items.length - end) * rowHeight,
  };
}
