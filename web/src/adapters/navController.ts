// ABOUTME: Navigation controller adapter for SVG pan, drag, wheel zoom, pinch-zoom, and double-tap-to-fit.
// ABOUTME: Attaches pointermove/pointerup globally; caller wires wheel/down/click to the container.
import { fitViewBox, panViewBox, toViewBoxString, zoomViewBox, type ViewBox } from "../core/viewbox";

export interface NavOpts {
  fitPoints: { x: number; y: number }[];
  onDragStateChange?(dragging: boolean): void;
}

export interface NavHandlers {
  onWheel(e: WheelEvent): void;
  onDown(e: PointerEvent): void;
  onClickCapture(e: MouseEvent): void;
}

// The wheel/down/click handlers are stashed on the function object so main.ts can
// attach them to the container after construction; this is the typed view of that slot.
type NavHandlerStore = { _handlers?: NavHandlers };

const DRAG_THRESHOLD = 4;

export function attachNav(svgGetter: () => SVGSVGElement | null, opts: NavOpts): { reset(): void } {
  const baseVb: ViewBox = fitViewBox(opts.fitPoints, 60);

  function current(): ViewBox {
    const svg = svgGetter();
    const raw = svg?.getAttribute("viewBox");
    if (!raw) return baseVb;
    const parts = raw.split(" ").map(Number);
    const [x, y, w, h] = [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, parts[3] ?? 0];
    return { x, y, w, h };
  }
  function apply(vb: ViewBox) {
    svgGetter()?.setAttribute("viewBox", toViewBoxString(vb));
  }

  function clientToWorld(svg: SVGSVGElement, clientX: number, clientY: number): { x: number; y: number } {
    const rect = svg.getBoundingClientRect();
    const vb = current();
    return {
      x: vb.x + ((clientX - rect.left) / rect.width) * vb.w,
      y: vb.y + ((clientY - rect.top) / rect.height) * vb.h,
    };
  }

  let dragging = false,
    moved = false,
    lastX = 0,
    lastY = 0;
  // Active pointers by id (for pinch); the gesture is a pinch whenever two are down.
  const pointers = new Map<number, { x: number; y: number }>();
  let pinchPrevDist = 0;
  // Double-tap-to-fit (replaces the old Reset view button): two quick taps near the same point refit.
  let lastTapTime = 0,
    lastTapX = 0,
    lastTapY = 0;

  function onWheel(e: WheelEvent) {
    const svg = svgGetter();
    if (!svg) return;
    e.preventDefault();
    const w = clientToWorld(svg, e.clientX, e.clientY);
    const factor = e.deltaY > 0 ? 1.1 : 1 / 1.1;
    apply(zoomViewBox(current(), w.x, w.y, factor, 80, baseVb.w * 1.5));
  }
  function onDown(e: PointerEvent) {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      // entering a pinch: stop any single-pointer pan and seed the reference distance
      dragging = false;
      opts.onDragStateChange?.(false);
      const [a, b] = [...pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
      pinchPrevDist = Math.hypot(a.x - b.x, a.y - b.y);
      return;
    }
    if (pointers.size > 2) return;
    if ((e.target as Element)?.getAttribute?.("data-star-id")) return; // let star taps through
    dragging = true;
    moved = false;
    lastX = e.clientX;
    lastY = e.clientY;
    opts.onDragStateChange?.(true);
  }
  function onMove(e: PointerEvent) {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size >= 2) {
      const svg = svgGetter();
      if (!svg) return;
      const [a, b] = [...pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchPrevDist > 0 && dist > 0) {
        const midX = (a.x + b.x) / 2;
        const midY = (a.y + b.y) / 2;
        const w = clientToWorld(svg, midX, midY);
        // fingers apart -> dist grows -> factor < 1 -> zoom in, about the gesture midpoint.
        apply(zoomViewBox(current(), w.x, w.y, pinchPrevDist / dist, 80, baseVb.w * 1.5));
      }
      pinchPrevDist = dist;
      return;
    }
    if (!dragging) return;
    const svg = svgGetter();
    if (!svg) return;
    const vb = current();
    const rect = svg.getBoundingClientRect();
    const dx = ((e.clientX - lastX) / rect.width) * vb.w;
    const dy = ((e.clientY - lastY) / rect.height) * vb.h;
    if (Math.abs(e.clientX - lastX) + Math.abs(e.clientY - lastY) > DRAG_THRESHOLD) moved = true;
    apply(panViewBox(vb, dx, dy));
    lastX = e.clientX;
    lastY = e.clientY;
  }
  function onUp(e: PointerEvent) {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchPrevDist = 0;
    if (pointers.size === 0 && dragging) {
      dragging = false;
      opts.onDragStateChange?.(false);
    }
    // A cancel is not a real tap: clear the first-tap anchor so a stale cancel can't pair with a later real tap.
    if (e.type === "pointercancel") {
      lastTapTime = 0;
      return;
    }
    // A tap (no drag) on empty map: detect a double-tap and refit. Skip when the tap landed on a star,
    // so double-tapping a star does not also reset the view.
    if (!moved && !(e.target as Element)?.getAttribute?.("data-star-id")) {
      const now = Date.now();
      if (now - lastTapTime < 300 && Math.abs(e.clientX - lastTapX) + Math.abs(e.clientY - lastTapY) < 20) {
        apply(baseVb);
        lastTapTime = 0;
      } else {
        lastTapTime = now;
        lastTapX = e.clientX;
        lastTapY = e.clientY;
      }
    }
  }
  function onClickCapture(e: MouseEvent) {
    if (moved) {
      e.stopPropagation();
      moved = false;
    }
  }

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);
  // Caller attaches these to the container in main.ts:
  (attachNav as unknown as NavHandlerStore)._handlers = { onWheel, onDown, onClickCapture };

  return {
    reset() {
      apply(baseVb);
    },
  };
}

export function navHandlers(): NavHandlers {
  return (attachNav as unknown as NavHandlerStore)._handlers!;
}
