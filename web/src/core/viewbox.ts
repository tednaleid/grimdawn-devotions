// ABOUTME: Pure pan/zoom math for the SVG devotion map viewBox.
// ABOUTME: All functions are stateless transforms; no DOM or IO dependencies.
export interface ViewBox { x: number; y: number; w: number; h: number }

export function fitViewBox(points: { x: number; y: number }[], pad: number): ViewBox {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  return { x: minX - pad, y: minY - pad, w: (maxX - minX) + 2 * pad, h: (maxY - minY) + 2 * pad };
}

export function panViewBox(vb: ViewBox, worldDx: number, worldDy: number): ViewBox {
  return { x: vb.x - worldDx, y: vb.y - worldDy, w: vb.w, h: vb.h };
}

export function zoomViewBox(
  vb: ViewBox, worldX: number, worldY: number, factor: number, minW: number, maxW: number,
): ViewBox {
  let nw = vb.w * factor;
  if (nw < minW) nw = minW;
  if (nw > maxW) nw = maxW;
  const applied = nw / vb.w;
  const nh = vb.h * applied;
  return {
    x: worldX - (worldX - vb.x) * applied,
    y: worldY - (worldY - vb.y) * applied,
    w: nw, h: nh,
  };
}

export function toViewBoxString(vb: ViewBox): string {
  return `${vb.x} ${vb.y} ${vb.w} ${vb.h}`;
}
