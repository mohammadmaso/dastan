export interface View {
  x: number;
  y: number;
  k: number;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const MIN_K = 0.2;
const MAX_K = 2.8;

export function clampZoom(k: number): number {
  return Math.min(MAX_K, Math.max(MIN_K, k));
}

/** Zoom so the world point under (mx, my) stays put. */
export function zoomAt(view: View, mx: number, my: number, factor: number): View {
  const k = clampZoom(view.k * factor);
  const wx = (mx - view.x) / view.k;
  const wy = (my - view.y) / view.k;
  return { k, x: mx - wx * k, y: my - wy * k };
}

export function fitView(box: Box, vw: number, vh: number, pad = 56): View {
  const k = clampZoom(
    Math.min((vw - pad * 2) / Math.max(box.w, 1), (vh - pad * 2) / Math.max(box.h, 1)),
  );
  return {
    k,
    x: (vw - box.w * k) / 2 - box.x * k,
    y: (vh - box.h * k) / 2 - box.y * k,
  };
}

export function clientToWorld(view: View, mx: number, my: number): { x: number; y: number } {
  return { x: (mx - view.x) / view.k, y: (my - view.y) / view.k };
}

export function centerOn(view: View, x: number, y: number, vw: number, vh: number): View {
  return { ...view, x: vw / 2 - x * view.k, y: vh / 2 - y * view.k };
}

function checkNav() {
  const origin = zoomAt({ x: 0, y: 0, k: 1 }, 100, 80, 2);
  const wx = (100 - origin.x) / origin.k;
  const wy = (80 - origin.y) / origin.k;
  if (Math.abs(wx - 100) > 1e-9 || Math.abs(wy - 80) > 1e-9) {
    throw new Error('zoomAt must keep the cursor world point');
  }
  const fitted = fitView({ x: 0, y: 0, w: 400, h: 200 }, 800, 400, 0);
  if (Math.abs(fitted.k - 2) > 1e-9) throw new Error('fitView should fill the shorter axis');
}

const entry = typeof process !== 'undefined' ? process.argv?.[1] : '';
if (entry && entry.includes('memory-graph-nav')) {
  checkNav();
  console.log('memory-graph-nav: ok');
}
