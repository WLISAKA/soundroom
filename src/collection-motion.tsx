import { useEffect, useState, type PointerEvent } from "react";

export function usePanelOpening<T>(panel: T, animate: boolean) {
  const [visiblePanel, setVisiblePanel] = useState(panel);
  useEffect(() => {
    if (!animate || matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setVisiblePanel(panel);
      return;
    }
    const timer = window.setTimeout(() => setVisiblePanel(panel), 160);
    return () => clearTimeout(timer);
  }, [panel, animate]);
  return animate && panel !== visiblePanel;
}

export function CollectionSkeleton({
  cards = false,
  label,
}: {
  cards?: boolean;
  label: string;
}) {
  return (
    <div className="collection-placeholder" role="status">
      <p className="loading-state">{label}</p>
      <div
        className={cards ? "skeleton-grid" : "skeleton-list"}
        aria-hidden="true"
      >
        {Array.from({ length: cards ? 4 : 6 }, (_, index) => (
          <div className="skeleton-card" key={index}>
            <i />
            <span>
              <i />
              <i />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function trackGlassReflection(event: PointerEvent<HTMLElement>) {
  if (event.pointerType !== "mouse") return;
  const card = event.currentTarget;
  const { left, top, width, height } = card.getBoundingClientRect();
  const x = Math.min(1, Math.max(0, (event.clientX - left) / width));
  const y = Math.min(1, Math.max(0, (event.clientY - top) / height));
  card.style.setProperty("--shine-x", `${x * 100}%`);
  card.style.setProperty("--shine-y", `${y * 100}%`);
  card.style.setProperty("--tilt-x", `${(0.5 - y) * 10}deg`);
  card.style.setProperty("--tilt-y", `${(x - 0.5) * 10}deg`);
}
