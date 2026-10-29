import type { ConveyorBelt, PlacedComponent, Port, Request, SimulationSnapshot } from '../game/types';
import { getComponentDef } from '../game/component-catalog';
import { REQUEST_COLORS } from '../game/types';
import { getComponentPorts, getSourcePort, loadColor } from '../game/simulation';
import type { ComponentInstanceConfig } from '../game/component-config';
import { renderConfigBadgesHtml } from '../game/component-config';
import { collectScaleGroupFrames, type ScaleGroupFrame } from '../game/board-layout';
import { WORLD_HEIGHT, WORLD_WIDTH } from './viewport';
import { beltLength, beltPathD, beltPoint, beltTangent } from '../game/belt-geometry';

/** Upper bound on dots drawn per frame; beyond this we sub-sample deterministically. */
const MAX_VISIBLE_REQUESTS = 260;
/**
 * Target spacing between drawn dots along a belt, in world px. Busy belts are
 * sub-sampled down to roughly this density so streams read as a flow rather
 * than a solid bar of overlapping circles.
 */
const MIN_DOT_SPACING = 11;
/** Max world-pixel offset from the belt centreline for lane spreading. */
const LANE_SPREAD = 6;
/** How far behind (in progress units) the motion trail starts. */
const TRAIL_LENGTH = 0.028;
/** Max queued requests drawn as beads in front of a component's input port. */
const MAX_QUEUE_BEADS = 10;
const LOAD_LERP_SPEED = 1.8;

interface DrawnRequest {
  x: number;
  y: number;
  r: number;
}

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
  private svg: SVGSVGElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private componentsLayer: HTMLElement | null = null;
  private scaleGroupsLayer: HTMLElement | null = null;
  private scaleGroupFrames = new Map<string, HTMLDivElement>();
  private componentGraphics = new Map<string, ComponentGraphics>();
  private beltGraphics: BeltGraphics[] = [];
  private displayedBeltLoads = new Map<string, number>();
  private portMap = new Map<string, Port>();
  private components: PlacedComponent[] = [];
  private belts: ConveyorBelt[] = [];
  private beltById = new Map<string, ConveyorBelt>();
  private componentConfigs = new Map<string, ComponentInstanceConfig>();
  private drawnRequests = new Map<number, DrawnRequest>();
  private beltLengths = new Map<string, number>();
  private tracedRequest: Request | null = null;
  private tracedComponentId: string | null = null;

  mount(
    board: HTMLElement,
    components: PlacedComponent[],
    belts: ConveyorBelt[],
    selectedComponentId: string | null = null,
    componentConfigs: Map<string, ComponentInstanceConfig> = new Map()
  ): void {
    this.components = components;
    this.belts = belts;
    this.componentConfigs = componentConfigs;
    this.beltById = new Map(belts.map((belt) => [belt.id, belt]));
    this.displayedBeltLoads.clear();
    this.rebuildPortMap();

    board.querySelector('.belts-layer')?.remove();
    board.querySelector('.scale-groups-layer')?.remove();
    board.querySelector('.components-layer')?.remove();
    board.querySelector('.particles-layer')?.remove();

    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.setAttribute('class', 'belts-layer');
    this.svg.setAttribute('width', String(WORLD_WIDTH));
    this.svg.setAttribute('height', String(WORLD_HEIGHT));

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'particles-layer';
    this.ctx = this.canvas.getContext('2d');

    this.scaleGroupsLayer = document.createElement('div');
    this.scaleGroupsLayer.className = 'scale-groups-layer';

    this.componentsLayer = document.createElement('div');
    this.componentsLayer.className = 'components-layer';

    const sourceNode = board.querySelector('.source-node');
    if (sourceNode) {
      board.insertBefore(this.svg, sourceNode);
      board.insertBefore(this.canvas, sourceNode);
      board.insertBefore(this.scaleGroupsLayer, sourceNode);
    } else {
      board.append(this.svg, this.canvas, this.scaleGroupsLayer);
    }
    board.appendChild(this.componentsLayer);

    this.resizeCanvas();
    this.buildBelts();
    this.buildScaleGroupFrames();
    this.buildComponents(selectedComponentId);
  }

  resizeCanvas(): void {
    if (!this.canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.floor(WORLD_WIDTH * dpr);
    this.canvas.height = Math.floor(WORLD_HEIGHT * dpr);
    this.canvas.style.width = `${WORLD_WIDTH}px`;
    this.canvas.style.height = `${WORLD_HEIGHT}px`;
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
    return beltPathD(from, to);
  }

  /** Point on the belt plus a lateral lane offset so streams spread out. */
  private pointOnBelt(from: Port, to: Port, t: number, lane = 0): { x: number; y: number } {
    const p = beltPoint(from, to, t);
    if (lane === 0) return p;
    const tangent = beltTangent(from, to, t);
    const offset = lane * LANE_SPREAD;
    return { x: p.x - tangent.y * offset, y: p.y + tangent.x * offset };
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
      this.beltLengths.set(belt.id, beltLength(from, to));
    }
  }

  private buildScaleGroupFrames(): void {
    if (!this.scaleGroupsLayer) return;
    this.scaleGroupsLayer.innerHTML = '';
    this.scaleGroupFrames.clear();

    for (const frame of collectScaleGroupFrames(this.components)) {
      const el = this.createScaleGroupFrameElement(frame);
      this.scaleGroupsLayer.appendChild(el);
      this.scaleGroupFrames.set(frame.primaryId, el);
    }
  }

  private createScaleGroupFrameElement(frame: ScaleGroupFrame): HTMLDivElement {
    const el = document.createElement('div');
    el.className = 'scale-group-frame';
    el.dataset.primaryId = frame.primaryId;
    el.style.left = `${frame.bounds.x}px`;
    el.style.top = `${frame.bounds.y}px`;
    el.style.width = `${frame.bounds.width}px`;
    el.style.height = `${frame.bounds.height}px`;
    el.innerHTML = `
      <span class="scale-group-label">
        <span class="scale-group-emoji">${frame.emoji}</span>
        <span class="scale-group-name">${frame.label}</span>
        <span class="scale-group-count">×${frame.instanceCount}</span>
      </span>
    `;
    return el;
  }

  private updateScaleGroupFrames(): void {
    const frames = collectScaleGroupFrames(this.components);
    const nextIds = new Set(frames.map((frame) => frame.primaryId));

    for (const id of [...this.scaleGroupFrames.keys()]) {
      if (!nextIds.has(id)) {
        this.scaleGroupFrames.get(id)?.remove();
        this.scaleGroupFrames.delete(id);
      }
    }

    for (const frame of frames) {
      let el = this.scaleGroupFrames.get(frame.primaryId);
      if (!el) {
        el = this.createScaleGroupFrameElement(frame);
        this.scaleGroupsLayer?.appendChild(el);
        this.scaleGroupFrames.set(frame.primaryId, el);
      }

      el.style.left = `${frame.bounds.x}px`;
      el.style.top = `${frame.bounds.y}px`;
      el.style.width = `${frame.bounds.width}px`;
      el.style.height = `${frame.bounds.height}px`;

      const countEl = el.querySelector('.scale-group-count');
      if (countEl) countEl.textContent = `×${frame.instanceCount}`;
    }
  }

  private buildComponents(selectedComponentId: string | null): void {
    if (!this.componentsLayer) return;
    this.componentsLayer.innerHTML = '';
    this.componentGraphics.clear();

    for (const component of this.components) {
      const def = getComponentDef(component.type);
      const root = document.createElement('div');
      root.className = `component${component.id === selectedComponentId ? ' selected' : ''}${
        component.scaleGroupId && component.scaleGroupId !== component.id ? ' scale-instance' : ''
      }`;
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
          ${renderConfigBadgesHtml(component, this.componentConfigs.get(component.id))}
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

  updateSelection(selectedComponentId: string | null): void {
    for (const [id, gfx] of this.componentGraphics) {
      gfx.root.classList.toggle('selected', id === selectedComponentId);
    }
  }

  updateComponentConfigs(componentConfigs: Map<string, ComponentInstanceConfig>): void {
    this.componentConfigs = componentConfigs;
    for (const component of this.components) {
      const gfx = this.componentGraphics.get(component.id);
      if (!gfx) continue;
      const inner = gfx.root.querySelector('.component-inner');
      if (!inner) continue;
      inner.querySelector('.component-config-badges')?.remove();
      const badgesHtml = renderConfigBadgesHtml(
        component,
        componentConfigs.get(component.id)
      );
      if (badgesHtml) {
        inner.insertAdjacentHTML('beforeend', badgesHtml);
      }
    }
  }

  updatePositions(components: PlacedComponent[]): void {
    this.components = components;
    this.rebuildPortMap();
    this.updateScaleGroupFrames();

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
      this.beltLengths.set(belt.id, beltLength(from, to));
    }
  }

  private lerp(current: number, target: number, dt: number): number {
    const factor = 1 - Math.exp(-LOAD_LERP_SPEED * dt);
    return current + (target - current) * factor;
  }

  /** Highlight one request on the board (or clear with null). */
  setTracedRequest(request: Request | null): void {
    this.tracedRequest = request;
  }

  getTracedRequest(): Request | null {
    return this.tracedRequest;
  }

  /** Find the request drawn closest to a world point within `radius` world px. */
  hitTestRequest(worldX: number, worldY: number, radius: number): number | null {
    let bestId: number | null = null;
    let bestDist = Infinity;
    for (const [id, drawn] of this.drawnRequests) {
      const d = Math.hypot(drawn.x - worldX, drawn.y - worldY) - drawn.r;
      if (d <= radius && d < bestDist) {
        bestDist = d;
        bestId = id;
      }
    }
    return bestId;
  }

  /**
   * @param dt           wall-clock seconds since last frame (for lerps)
   * @param interpSeconds simulation seconds not yet consumed by a fixed tick;
   *                      traveling requests are advanced by this for smooth motion
   */
  update(snapshot: SimulationSnapshot | null, dt: number, interpSeconds = 0): void {
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
      this.setTracedComponent(null);
      return;
    }

    for (const [id, gfx] of this.componentGraphics) {
      const compState = snapshot.components.get(id);
      const primaryId = gfx.component.scaleGroupId ?? id;
      const isPrimary = primaryId === id;
      const scaling = snapshot.scaling.get(primaryId);
      const targetLoad = compState?.load ?? 0;
      gfx.displayedLoad = this.lerp(gfx.displayedLoad, targetLoad, dt);
      const loadPct = Math.min(gfx.displayedLoad, 100);
      gfx.root.style.setProperty('--load', String(loadPct));
      gfx.loadEl.textContent = compState ? `${Math.round(loadPct)}%` : '';

      gfx.root.classList.toggle('failed', compState?.failed ?? false);
      gfx.root.classList.toggle('starting-up', compState?.startingUp ?? false);

      const warnLoad = gfx.displayedLoad;
      let badgeText = '';
      if (compState?.failed) badgeText = 'FAILED';
      else if (compState?.startingUp) {
        badgeText = `BOOT ${Math.round((compState.startupProgress ?? 0) * 100)}%`;
      } else if (isPrimary && scaling && scaling.instances > 1) {
        badgeText =
          scaling.verticalMultiplier > 1
            ? `×${scaling.instances} ↑${scaling.verticalMultiplier.toFixed(1)}`
            : `×${scaling.instances}`;
      } else if (isPrimary && scaling && scaling.verticalMultiplier > 1) {
        badgeText = `↑×${scaling.verticalMultiplier.toFixed(1)}`;
      } else if (warnLoad >= 85) badgeText = 'HOT';

      if (badgeText) {
        if (!gfx.badge) {
          gfx.badge = document.createElement('div');
          gfx.root.appendChild(gfx.badge);
        }
        let badgeClass = 'warn-badge';
        if (badgeText === 'FAILED') badgeClass = 'fail-badge';
        else if (compState?.startingUp) badgeClass = 'startup-badge';
        gfx.badge.className = badgeClass;
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

    this.drawRequests(snapshot, interpSeconds);
  }

  private clearParticles(): void {
    if (!this.ctx || !this.canvas) return;
    this.ctx.clearRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    this.drawnRequests.clear();
  }

  private setTracedComponent(componentId: string | null): void {
    if (componentId === this.tracedComponentId) return;
    if (this.tracedComponentId) {
      this.componentGraphics.get(this.tracedComponentId)?.root.classList.remove('tracing');
    }
    this.tracedComponentId = componentId;
    if (componentId) {
      this.componentGraphics.get(componentId)?.root.classList.add('tracing');
    }
  }

  private drawRequests(snapshot: SimulationSnapshot, interpSeconds: number): void {
    if (!this.ctx || !this.canvas) return;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    this.drawnRequests.clear();

    const traced = this.tracedRequest;
    const tracedId = traced?.id ?? null;

    const traveling: Request[] = [];
    const queuedByComponent = new Map<string, Request[]>();
    for (const req of snapshot.activeRequests) {
      if (req.state === 'traveling' && req.beltId) {
        traveling.push(req);
      } else if ((req.state === 'queued' || req.state === 'processing') && req.currentComponentId) {
        const list = queuedByComponent.get(req.currentComponentId);
        if (list) list.push(req);
        else queuedByComponent.set(req.currentComponentId, [req]);
      }
    }

    // Deterministic sub-sampling: each request has a stable key, so the same
    // dots stay visible from frame to frame instead of flickering. The keep
    // ratio is computed per belt from its length, so a long, busy belt shows
    // more dots than a short one but neither turns into a solid bar.
    const travelingPerBelt = new Map<string, number>();
    for (const req of traveling) {
      travelingPerBelt.set(req.beltId!, (travelingPerBelt.get(req.beltId!) ?? 0) + 1);
    }
    const globalKeep =
      traveling.length > MAX_VISIBLE_REQUESTS ? MAX_VISIBLE_REQUESTS / traveling.length : 1;
    const keepPerBelt = new Map<string, number>();
    for (const [beltId, count] of travelingPerBelt) {
      const length = this.beltLengths.get(beltId) ?? 400;
      const capacity = Math.max(4, Math.floor(length / MIN_DOT_SPACING));
      keepPerBelt.set(beltId, Math.min(globalKeep, count > capacity ? capacity / count : 1));
    }

    for (const req of traveling) {
      const isTraced = req.id === tracedId;
      const keep = keepPerBelt.get(req.beltId!) ?? 1;
      if (!isTraced && keep < 1 && req.visualKey >= keep) continue;

      const belt = this.beltById.get(req.beltId!);
      if (!belt) continue;
      const from = this.portMap.get(belt.fromPortId);
      const to = this.portMap.get(belt.toPortId);
      if (!from || !to) continue;

      const progress = Math.min(0.999, req.progress + req.travelSpeed * interpSeconds);
      const pos = this.pointOnBelt(from, to, progress, req.lane);
      const color = REQUEST_COLORS[req.colorIndex];
      const radius = req.celebrity ? 4.2 : 3.1;

      // Short motion trail behind the dot.
      const trailT = Math.max(0, progress - TRAIL_LENGTH);
      if (trailT < progress) {
        const tail = this.pointOnBelt(from, to, trailT, req.lane);
        ctx.beginPath();
        ctx.moveTo(tail.x, tail.y);
        ctx.lineTo(pos.x, pos.y);
        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.22;
        ctx.lineWidth = radius * 1.3;
        ctx.lineCap = 'round';
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      ctx.beginPath();
      ctx.fillStyle = color;
      ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
      ctx.fill();

      if (req.celebrity) {
        ctx.strokeStyle = 'rgba(30, 30, 30, 0.4)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      this.drawnRequests.set(req.id, { x: pos.x, y: pos.y, r: radius });
      if (isTraced) this.drawTraceHalo(pos.x, pos.y, radius);
    }

    // Queued requests wait as a small column of beads in front of the input port.
    let tracedComponentId: string | null = null;
    for (const [componentId, queued] of queuedByComponent) {
      const inPort = this.portMap.get(`${componentId}:in`);
      if (!inPort) continue;

      const count = queued.length;
      const shown = Math.min(count, MAX_QUEUE_BEADS);
      const spacing = 7;
      const startY = inPort.y - ((shown - 1) * spacing) / 2;
      const x = inPort.x - 14;

      for (let i = 0; i < shown; i++) {
        const req = queued[i];
        const y = startY + i * spacing;
        ctx.beginPath();
        ctx.fillStyle = REQUEST_COLORS[req.colorIndex];
        ctx.globalAlpha = 0.9;
        ctx.arc(x, y, 2.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        this.drawnRequests.set(req.id, { x, y, r: 2.6 });
        if (req.id === tracedId) this.drawTraceHalo(x, y, 2.6);
      }

      if (count > shown) {
        ctx.fillStyle = 'rgba(95, 99, 104, 0.9)';
        ctx.font = '600 9px ui-monospace, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(`+${count - shown}`, x, startY + shown * spacing);
      }

      if (tracedId !== null && queued.some((r) => r.id === tracedId)) {
        tracedComponentId = componentId;
        if (!this.drawnRequests.has(tracedId)) {
          this.drawTraceHalo(x, startY + shown * spacing + 12, 3);
        }
      }
    }

    this.setTracedComponent(tracedComponentId);
  }

  private drawTraceHalo(x: number, y: number, radius: number): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.arc(x, y, radius + 6, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(105, 101, 219, 0.95)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, radius + 11, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(105, 101, 219, 0.3)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}
