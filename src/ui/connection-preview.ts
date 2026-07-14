import type { Port } from '../game/types';
import { WORLD_HEIGHT, WORLD_WIDTH } from './viewport';

export class ConnectionPreview {
  private svg: SVGSVGElement | null = null;
  private path: SVGPathElement | null = null;

  mount(board: HTMLElement): void {
    this.destroy();
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.setAttribute('class', 'connection-preview-layer');
    this.svg.setAttribute('width', String(WORLD_WIDTH));
    this.svg.setAttribute('height', String(WORLD_HEIGHT));

    this.path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    this.path.setAttribute('class', 'connection-preview-path');
    this.svg.appendChild(this.path);

    board.appendChild(this.svg);
  }

  update(from: Port, to: { x: number; y: number }): void {
    if (!this.path) return;
    const dx = to.x - from.x;
    const cx1 = from.x + dx * 0.45;
    const cx2 = to.x - dx * 0.45;
    const d = `M ${from.x} ${from.y} C ${cx1} ${from.y}, ${cx2} ${to.y}, ${to.x} ${to.y}`;
    this.path.setAttribute('d', d);
    this.svg?.classList.add('visible');
  }

  clear(): void {
    this.path?.setAttribute('d', '');
    this.svg?.classList.remove('visible');
  }

  destroy(): void {
    this.svg?.remove();
    this.svg = null;
    this.path = null;
  }
}
