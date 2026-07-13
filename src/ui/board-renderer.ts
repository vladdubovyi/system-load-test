import type { ConveyorBelt, PlacedComponent, Port, SimulationSnapshot } from '../game/types';
import { COMPONENT_DEFS, REQUEST_COLORS } from '../game/types';
import { getComponentPorts, getSourcePort, loadColor } from '../game/simulation';

const MAX_PARTICLES = 72;
const MAX_PARTICLES_PER_BELT = 10;

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
}

export class BoardRenderer {
  private board: HTMLElement | null = null;
  private svg: SVGSVGElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private componentsLayer: HTMLElement | null = null;
  private componentGraphics = new Map<string, ComponentGraphics>();
  private beltGraphics: BeltGraphics[] = [];
  private portMap = new Map<string, Port>();
  private components: PlacedComponent[] = [];
  private belts: ConveyorBelt[] = [];
  private particlePhase = 0;

  mount(
    board: HTMLElement,
    components: PlacedComponent[],
    belts: ConveyorBelt[]
  ): void {
    this.board = board;
    this.components = components;
    this.belts = belts;
    this.rebuildPortMap();

    board.querySelector('.belts-layer')?.remove();
    board.querySelector('.components-layer')?.remove();
    board.querySelector('.particles-layer')?.remove();

    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.setAttribute('class', 'belts-layer');
    this.svg.innerHTML = `
      <defs>
        <filter id="particle-glow">
          <feGaussianBlur stdDeviation="2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
    `;

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

  private buildBelts(): void {
    if (!this.svg) return;
    this.beltGraphics = [];
    const defs = this.svg.querySelector('defs');

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
      this.svg.insertBefore(group, defs);
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

  update(snapshot: SimulationSnapshot | null, dt: number): void {
    this.particlePhase += dt;

    if (!snapshot) {
      for (const gfx of this.componentGraphics.values()) {
        gfx.root.style.setProperty('--load', '0');
        gfx.loadEl.textContent = '';
        gfx.root.classList.remove('failed');
      }
      for (const { fill } of this.beltGraphics) {
        fill.style.stroke = loadColor(0);
        fill.style.setProperty('--belt-load', '0');
      }
      this.clearParticles();
      return;
    }

    for (const [id, gfx] of this.componentGraphics) {
      const compState = snapshot.components.get(id);
      const load = compState?.load ?? 0;
      const loadPct = Math.min(load, 100);
      gfx.root.style.setProperty('--load', String(loadPct));
      gfx.loadEl.textContent = compState ? `${Math.round(load)}%` : '';

      gfx.root.classList.toggle('failed', compState?.failed ?? false);

      let badgeText = '';
      if (compState?.failed) badgeText = 'FAILED';
      else if (load >= 85) badgeText = 'HOT';

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
      const load = beltState?.load ?? 0;
      fill.style.stroke = loadColor(load);
      fill.style.setProperty('--belt-load', String(Math.min(load, 100)));
    }

    this.drawParticles(snapshot);
  }

  private clearParticles(): void {
    if (!this.ctx || !this.canvas) return;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  private drawParticles(snapshot: SimulationSnapshot): void {
    if (!this.ctx || !this.canvas || !this.board) return;
    const rect = this.board.getBoundingClientRect();
    this.ctx.clearRect(0, 0, rect.width, rect.height);

    const travelingTotal = [...snapshot.belts.values()].reduce(
      (sum, belt) => sum + belt.traveling,
      0
    );
    if (travelingTotal <= 0) return;

    let remaining = MAX_PARTICLES;
    const visuals = snapshot.beltVisuals;

    for (const { belt } of this.beltGraphics) {
      if (remaining <= 0) break;

      const beltState = snapshot.belts.get(belt.id);
      const traveling = beltState?.traveling ?? 0;
      if (traveling <= 0) continue;

      const from = this.portMap.get(belt.fromPortId);
      const to = this.portMap.get(belt.toPortId);
      if (!from || !to) continue;

      const share = traveling / travelingTotal;
      const count = Math.min(
        MAX_PARTICLES_PER_BELT,
        remaining,
        Math.max(1, Math.round(share * MAX_PARTICLES))
      );
      remaining -= count;

      const visual = visuals.get(belt.id);
      const color = REQUEST_COLORS[visual?.colorIndex ?? 0];
      const celebrity = visual?.celebrity ?? false;

      for (let i = 0; i < count; i++) {
        const phase = (this.particlePhase * 0.9 + i / count + belt.id.length * 0.01) % 1;
        const t = phase;
        const x = from.x + (to.x - from.x) * t;
        const y = from.y + (to.y - from.y) * t + Math.sin(t * Math.PI) * -14;
        const radius = celebrity ? 5 : 3.5;

        this.ctx.beginPath();
        this.ctx.fillStyle = color;
        this.ctx.arc(x, y, radius, 0, Math.PI * 2);
        this.ctx.fill();

        if (celebrity) {
          this.ctx.strokeStyle = 'rgba(255,255,255,0.7)';
          this.ctx.lineWidth = 1;
          this.ctx.stroke();
        }
      }
    }
  }
}
