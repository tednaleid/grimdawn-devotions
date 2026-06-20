// ABOUTME: Navigation controller adapter for SVG pan, drag, and wheel zoom.
// ABOUTME: Attaches mousemove/mouseup globally; caller wires wheel/down/click to the container.
import { fitViewBox, panViewBox, toViewBoxString, zoomViewBox, type ViewBox } from "../core/viewbox";

export interface NavOpts {
  fitPoints: { x: number; y: number }[];
  onDragStateChange?(dragging: boolean): void;
}

const DRAG_THRESHOLD = 4;

export function attachNav(svgGetter: () => SVGSVGElement | null, opts: NavOpts): { reset(): void } {
  const baseVb: ViewBox = fitViewBox(opts.fitPoints, 60);

  function current(): ViewBox {
    const svg = svgGetter();
    const raw = svg?.getAttribute("viewBox");
    if (!raw) return baseVb;
    const [x, y, w, h] = raw.split(" ").map(Number);
    return { x, y, w, h };
  }
  function apply(vb: ViewBox) { svgGetter()?.setAttribute("viewBox", toViewBoxString(vb)); }

  function clientToWorld(svg: SVGSVGElement, clientX: number, clientY: number): { x: number; y: number } {
    const rect = svg.getBoundingClientRect();
    const vb = current();
    return {
      x: vb.x + ((clientX - rect.left) / rect.width) * vb.w,
      y: vb.y + ((clientY - rect.top) / rect.height) * vb.h,
    };
  }

  let dragging = false, moved = false, lastX = 0, lastY = 0;

  function onWheel(e: WheelEvent) {
    const svg = svgGetter(); if (!svg) return;
    e.preventDefault();
    const w = clientToWorld(svg, e.clientX, e.clientY);
    const factor = e.deltaY > 0 ? 1.1 : 1 / 1.1;
    apply(zoomViewBox(current(), w.x, w.y, factor, 80, baseVb.w * 1.5));
  }
  function onDown(e: MouseEvent) {
    if ((e.target as Element)?.getAttribute?.("data-star-id")) return; // let star clicks through
    dragging = true; moved = false; lastX = e.clientX; lastY = e.clientY;
    opts.onDragStateChange?.(true);
  }
  function onMove(e: MouseEvent) {
    if (!dragging) return;
    const svg = svgGetter(); if (!svg) return;
    const vb = current();
    const rect = svg.getBoundingClientRect();
    const dx = ((e.clientX - lastX) / rect.width) * vb.w;
    const dy = ((e.clientY - lastY) / rect.height) * vb.h;
    if (Math.abs(e.clientX - lastX) + Math.abs(e.clientY - lastY) > DRAG_THRESHOLD) moved = true;
    apply(panViewBox(vb, dx, dy));
    lastX = e.clientX; lastY = e.clientY;
  }
  function onUp() { if (dragging) { dragging = false; opts.onDragStateChange?.(false); } }
  function onClickCapture(e: MouseEvent) { if (moved) { e.stopPropagation(); moved = false; } }

  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
  // Caller attaches these to the container in main.ts:
  (attachNav as any)._handlers = { onWheel, onDown, onClickCapture };

  return { reset() { apply(baseVb); } };
}

export function navHandlers() {
  return (attachNav as any)._handlers as {
    onWheel(e: WheelEvent): void; onDown(e: MouseEvent): void; onClickCapture(e: MouseEvent): void;
  };
}
