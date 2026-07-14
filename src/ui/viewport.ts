export interface ViewportState {
  panX: number;
  panY: number;
  zoom: number;
}

export const DEFAULT_VIEWPORT: ViewportState = {
  panX: 0,
  panY: 0,
  zoom: 1,
};

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 2.5;
export const WORLD_WIDTH = 3200;
export const WORLD_HEIGHT = 2200;

export function clampZoom(zoom: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
}

export function screenToWorld(
  screenX: number,
  screenY: number,
  viewportRect: DOMRect,
  viewport: ViewportState
): { x: number; y: number } {
  return {
    x: (screenX - viewportRect.left - viewport.panX) / viewport.zoom,
    y: (screenY - viewportRect.top - viewport.panY) / viewport.zoom,
  };
}

export function worldToScreen(
  worldX: number,
  worldY: number,
  viewportRect: DOMRect,
  viewport: ViewportState
): { x: number; y: number } {
  return {
    x: viewportRect.left + viewport.panX + worldX * viewport.zoom,
    y: viewportRect.top + viewport.panY + worldY * viewport.zoom,
  };
}

export function applyViewportStyles(element: HTMLElement, viewport: ViewportState): void {
  element.style.transform = `translate(${viewport.panX}px, ${viewport.panY}px)`;
  element.style.zoom = `${viewport.zoom}`;
}

/** @deprecated use applyViewportStyles */
export function viewportTransform(viewport: ViewportState): string {
  return `translate(${viewport.panX}px, ${viewport.panY}px)`;
}
