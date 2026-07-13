import type { ConveyorBelt, PlacedComponent, Port, SimulationSnapshot } from '../game/types';
import { COMPONENT_DEFS, REQUEST_COLORS } from '../game/types';
import { getComponentPorts, getSourcePort, loadColor } from '../game/simulation';

/** Each visible package represents this many simulated requests. */
const REQUESTS_PER_BATCH = 14;
const MAX_BATCHES_TOTAL = 16;
const MAX_BATCHES_PER_BELT = 3;
const BATCH_TRANSIT_SECONDS = 3.2;
const BATCH_SPACING = 0.28;
const LOAD_LERP_SPEED = 1.8;

interface BeltGraphics {
  belt: ConveyorBelt;
  track: SVGPathElement;
  fill: SVGPathElement;
}

interface ComponentGraphics {
  component: PlacedComponent;
  root: HTMLDivElement;
  loadEl: HTMLSpanElement;
  badge: HTMLDivElement | null;
  displayedLoad: number;
}

export class BoardRenderer {
  private board: HTMLElement | null = null;
  private svg: SVGSVGElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private componentsLayer: HTMLElement | null = null;
  private componentGraphics = new Map<string, ComponentGraphics>();
  private beltGraphics: BeltGraphics[] = [];
  private displayedBeltLoads = new Map<string, number>();
  private portMap = new Map<string, Port>();
  private components: PlacedComponent[] = [];
  private belts: ConveyorBelt[] = [];
  private flowTime = 0;

  mount(
    board: HTMLElement,
    components: PlacedComponent[],
    belts: ConveyorBelt[]
  ): void {
    this.board = board;
    this.components = components;
    this.belts = belts;
    this.flowTime = 0;
    this.displayedBeltLoads.clear();
    this.rebuildPortMap();

    board.querySelector('.belts-layer')?.remove();
    board.querySelector('.components-layer')?.remove();
    board.querySelector('.particles-layer')?.remove();

    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.setAttribute('class', 'belts-layer');

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'particles-layer';
    this.ctx = this.canvas.getContext('2d');

    this.componentsLayer = document.createElement('div');
    this.componentsLayer.className = 'components-layer';

    board.insertBefore(this.svg, board.querySelector('.source-node'));
    board.insertBefore(this.canvas, board.querySelector('.source-node'));
    board.appendChild(this.componentsLayer);

    this.resizeCanvas();
    this.buildBelts();
    this.buildComponents();
  }

  resizeCanvas(): void {
    if (!this.board || !this.canvas) return;
    const rect = this.board.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.floor(rect.width * dpr);
    this.canvas.height = Math.floor(rect.height * dpr);
    this.canvas.style.width = `${rect.width}px`;
    this.canvas.style.height = `${rect.height}px`;
    this.ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private rebuildPortMap(): void {
    this.portMap.clear();
    const source = getSourcePort(this.components);
    this.portMap.set(source.id, source);
    for (const component of this.components) {
      for (const port of getComponentPorts(component)) {
        this.portMap.set(port.id, port);
      }
    }
  }

  private beltPath(from: Port, to: Port): string {
    const dx = to.x - from.x;
    const cx1 = from.x + dx * 0.45;
    const cx2 = to.x - dx * 0.45;
    return `M ${from.x} ${from.y} C ${cx1} ${from.y}, ${cx2} ${to.y}, ${to.x} ${to.y}`;
  }

  private pointOnBelt(from: Port, to: Port, t: number): { x: number; y: number } {
    const dx = to.x - from.x;
    const cx1 = from.x + dx * 0.45;
    const cx2 = to.x - dx * 0.45;
    const u = 1 - t;
    const x =
      u * u * u * from.x +
      3 * u * u * t * cx1 +
      3 * u * t * t * cx2 +
      t * t * t * to.x;
    const y =
      u * u * u * from.y +
      3 * u * u * t * from.y +
      3 * u * t * t * to.y +
      t * t * t * to.y;
    return { x, y: y + Math.sin(t * Math.PI) * -12 };
  }

  private buildBelts(): void {
    if (!this.svg) return;
    this.beltGraphics = [];

    for (const belt of this.belts) {
      const from = this.portMap.get(belt.fromPortId);
      const to = this.portMap.get(belt.toPortId);
      if (!from || !to) continue;

      const path = this.beltPath(from, to);
      const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      group.setAttribute('class', 'belt-group');
      group.dataset.beltId = belt.id;

      const track = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      track.setAttribute('class', 'belt-track');
      track.setAttribute('d', path);

      const fill = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      fill.setAttribute('class', 'belt-fill');
      fill.setAttribute('d', path);

      group.append(track, fill);
      this.svg.appendChild(group);
      this.beltGraphics.push({ belt, track, fill });
    }
  }

  private buildComponents(): void {
    if (!this.componentsLayer) return;
    this.componentsLayer.innerHTML = '';
    this.componentGraphics.clear();

    for (const component of this.components) {
      const def = COMPONENT_DEFS[component.type];
      const root = document.createElement('div');
      root.className = 'component';
      root.dataset.id = component.id;
      root.style.left = `${component.x}px`;
      root.style.top = `${component.y}px`;
      root.style.width = `${component.width}px`;
      root.style.height = `${component.height}px`;

      root.innerHTML = `
        <div class="component-glow"></div>
        <div class="component-inner">
          <span class="component-emoji">${def.emoji}</span>
          <span class="component-name">${def.label}</span>
          <span class="component-load"></span>
        </div>
        <button class="port port-in" data-port-id="${component.id}:in" type="button" title="Input"></button>
        <button class="port port-out" data-port-id="${component.id}:out" type="button" title="Output"></button>
      `;

      this.componentsLayer.appendChild(root);
      this.componentGraphics.set(component.id, {
        component,
        root,
        loadEl: root.querySelector('.component-load')!,
        badge: null,
        displayedLoad: 0,
      });
    }
  }

  updatePositions(components: PlacedComponent[]): void {
    this.components = components;
    this.rebuildPortMap();

    for (const component of components) {
      const gfx = this.componentGraphics.get(component.id);
      if (!gfx) continue;
      gfx.component = component;
      gfx.root.style.left = `${component.x}px`;
      gfx.root.style.top = `${component.y}px`;
    }

    for (const { belt, track, fill } of this.beltGraphics) {
      const from = this.portMap.get(belt.fromPortId);
      const to = this.portMap.get(belt.toPortId);
      if (!from || !to) continue;
      const path = this.beltPath(from, to);
      track.setAttribute('d', path);
      fill.setAttribute('d', path);
    }
  }

  private lerp(current: number, target: number, dt: number): number {
    const factor = 1 - Math.exp(-LOAD_LERP_SPEED * dt);
    return current + (target - current) * factor;
  }

  update(snapshot: SimulationSnapshot | null, dt: number): void {
    this.flowTime += dt;

    if (!snapshot) {
      for (const gfx of this.componentGraphics.values()) {
        gfx.displayedLoad = 0;
        gfx.root.style.setProperty('--load', '0');
        gfx.loadEl.textContent = '';
        gfx.root.classList.remove('failed');
      }
      for (const { fill, belt } of this.beltGraphics) {
        this.displayedBeltLoads.set(belt.id, 0);
        fill.style.stroke = loadColor(0);
        fill.style.setProperty('--belt-load', '0');
      }
      this.clearParticles();
      return;
    }

    for (const [id, gfx] of this.componentGraphics) {
      const compState = snapshot.components.get(id);
      const targetLoad = compState?.load ?? 0;
      gfx.displayedLoad = this.lerp(gfx.displayedLoad, targetLoad, dt);
      const loadPct = Math.min(gfx.displayedLoad, 100);
      gfx.root.style.setProperty('--load', String(loadPct));
      gfx.loadEl.textContent = compState ? `${Math.round(gfx.displayedLoad)}%` : '';

      gfx.root.classList.toggle('failed', compState?.failed ?? false);

      const warnLoad = gfx.displayedLoad;
      let badgeText = '';
      if (compState?.failed) badgeText = 'FAILED';
      else if (warnLoad >= 85) badgeText = 'HOT';

      if (badgeText) {
        if (!gfx.badge) {
          gfx.badge = document.createElement('div');
          gfx.root.appendChild(gfx.badge);
        }
        gfx.badge.className = badgeText === 'FAILED' ? 'fail-badge' : 'warn-badge';
        gfx.badge.textContent = badgeText;
      } else if (gfx.badge) {
        gfx.badge.remove();
        gfx.badge = null;
      }
    }

    for (const { belt, fill } of this.beltGraphics) {
      const beltState = snapshot.belts.get(belt.id);
      const targetLoad = beltState?.load ?? 0;
      const current = this.displayedBeltLoads.get(belt.id) ?? 0;
      const displayed = this.lerp(current, targetLoad, dt);
      this.displayedBeltLoads.set(belt.id, displayed);
      fill.style.stroke = loadColor(displayed);
      fill.style.setProperty('--belt-load', String(Math.min(displayed, 100)));
    }

    this.drawBatches(snapshot);
  }

  private clearParticles(): void {
    if (!this.ctx || !this.canvas) return;
    const rect = this.board?.getBoundingClientRect();
    if (!rect) return;
    this.ctx.clearRect(0, 0, rect.width, rect.height);
  }

  private drawBatches(snapshot: SimulationSnapshot): void {
    if (!this.ctx || !this.canvas || !this.board) return;
    const rect = this.board.getBoundingClientRect();
    this.ctx.clearRect(0, 0, rect.width, rect.height);

    const beltLoads = [...this.beltGraphics]
      .map(({ belt }) => ({
        belt,
        traveling: snapshot.belts.get(belt.id)?.traveling ?? 0,
      }))
      .filter((entry) => entry.traveling > 0)
      .sort((a, b) => b.traveling - a.traveling);

    if (beltLoads.length === 0) return;

    const travelingTotal = beltLoads.reduce((sum, entry) => sum + entry.traveling, 0);
    let batchesLeft = MAX_BATCHES_TOTAL;

    for (const { belt, traveling } of beltLoads) {
      if (batchesLeft <= 0) break;

      const from = this.portMap.get(belt.fromPortId);
      const to = this.portMap.get(belt.toPortId);
      if (!from || !to) continue;

      const share = traveling / travelingTotal;
      const batchCount = Math.min(
        MAX_BATCHES_PER_BELT,
        batchesLeft,
        Math.max(1, Math.round(share * MAX_BATCHES_TOTAL)),
        Math.ceil(traveling / REQUESTS_PER_BATCH)
      );
      batchesLeft -= batchCount;

      const visual = snapshot.beltVisuals.get(belt.id);
      const color = REQUEST_COLORS[visual?.colorIndex ?? 0];
      const celebrity = visual?.celebrity ?? false;
      const requestsPerBatch = Math.max(1, Math.round(traveling / batchCount));

      for (let i = 0; i < batchCount; i++) {
        const offset = i * BATCH_SPACING;
        const phase =
          (this.flowTime / BATCH_TRANSIT_SECONDS + offset + belt.id.length * 0.013) % 1;
        const pos = this.pointOnBelt(from, to, phase);
        this.drawPackage(pos.x, pos.y, color, requestsPerBatch, celebrity);
      }
    }
  }

  private drawPackage(
    x: number,
    y: number,
    color: string,
    count: number,
    celebrity: boolean
  ): void {
    if (!this.ctx) return;

    const w = celebrity ? 22 : 18;
    const h = celebrity ? 14 : 12;
    const r = 3;

    this.ctx.save();
    this.ctx.translate(x, y);

    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    this.ctx.beginPath();
    this.ctx.roundRect(-w / 2 + 1, -h / 2 + 1, w, h, r);
    this.ctx.fill();

    this.ctx.fillStyle = color;
    this.ctx.strokeStyle = celebrity ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.35)';
    this.ctx.lineWidth = celebrity ? 1.5 : 1;
    this.ctx.beginPath();
    this.ctx.roundRect(-w / 2, -h / 2, w, h, r);
    this.ctx.fill();
    this.ctx.stroke();

    if (count > 1) {
      this.ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
      this.ctx.font = '600 8px JetBrains Mono, monospace';
      this.ctx.textAlign = 'center';
      this.ctx.textBaseline = 'middle';
      this.ctx.fillText(`×${count}`, 0, 0.5);
    }

    this.ctx.restore();
  }
}
