import { SCENARIO, REQUEST_COLORS } from '../game/types';
import type { BoardAnnotations, DrawStroke, TextAnnotation } from '../game/board-annotations';
import { strokeToPath } from '../game/board-annotations';

const CELEBRITY_INDICES = [1, 2, 3];

export class AnnotationRenderer {
  private layer: HTMLElement | null = null;
  private strokesSvg: SVGSVGElement | null = null;
  private textsLayer: HTMLElement | null = null;
  private problemEl: HTMLElement | null = null;
  private liveStrokeEl: SVGPathElement | null = null;

  mount(world: HTMLElement): void {
    this.layer = document.createElement('div');
    this.layer.className = 'annotations-layer';

    this.problemEl = document.createElement('div');
    this.problemEl.className = 'board-problem-frame';
    this.problemEl.innerHTML = renderProblemFrame();

    this.strokesSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.strokesSvg.setAttribute('class', 'strokes-layer');

    this.textsLayer = document.createElement('div');
    this.textsLayer.className = 'texts-layer';

    this.layer.append(this.problemEl, this.strokesSvg, this.textsLayer);
    world.insertBefore(this.layer, world.firstChild);
  }

  render(annotations: BoardAnnotations): void {
    this.renderStrokes(annotations.strokes);
    this.renderTexts(annotations.texts);
  }

  renderLiveStroke(stroke: DrawStroke | null): void {
    if (!this.strokesSvg) return;
    this.liveStrokeEl?.remove();
    this.liveStrokeEl = null;
    if (!stroke || stroke.points.length < 2) return;

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('class', 'board-stroke board-stroke-live');
    path.setAttribute('d', strokeToPath(stroke));
    path.setAttribute('stroke', stroke.color);
    path.setAttribute('stroke-width', String(stroke.width));
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    this.strokesSvg.appendChild(path);
    this.liveStrokeEl = path;
  }

  private renderStrokes(strokes: DrawStroke[]): void {
    if (!this.strokesSvg) return;
    this.strokesSvg.innerHTML = '';
    this.liveStrokeEl = null;

    for (const stroke of strokes) {
      if (stroke.points.length < 2) continue;
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('class', 'board-stroke');
      path.setAttribute('data-stroke-id', stroke.id);
      path.setAttribute('d', strokeToPath(stroke));
      path.setAttribute('stroke', stroke.color);
      path.setAttribute('stroke-width', String(stroke.width));
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke-linecap', 'round');
      path.setAttribute('stroke-linejoin', 'round');
      this.strokesSvg.appendChild(path);
    }
  }

  private renderTexts(texts: TextAnnotation[]): void {
    if (!this.textsLayer) return;
    this.textsLayer.innerHTML = '';

    for (const text of texts) {
      const el = document.createElement('div');
      el.className = 'board-text';
      el.dataset.textId = text.id;
      el.style.left = `${text.x}px`;
      el.style.top = `${text.y}px`;
      el.style.width = `${text.width}px`;
      el.style.minHeight = `${text.minHeight}px`;
      el.textContent = text.content;
      this.textsLayer.appendChild(el);
    }
  }

  updateTextContent(id: string, content: string): void {
    const el = this.textsLayer?.querySelector(`[data-text-id="${id}"]`);
    if (el) el.textContent = content;
  }

  beginTextEdit(id: string, onFinish: (content: string) => void): void {
    const el = this.textsLayer?.querySelector(`[data-text-id="${id}"]`) as HTMLElement | null;
    if (!el) return;

    el.contentEditable = 'true';
    el.classList.add('editing');
    el.focus();

    const range = document.createRange();
    range.selectNodeContents(el);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    const finish = (): void => {
      const content = el.textContent ?? '';
      el.contentEditable = 'false';
      el.classList.remove('editing');
      el.removeEventListener('blur', finish);
      onFinish(content);
    };

    el.addEventListener('blur', finish);
  }

  updateTextSelection(selectedTextId: string | null): void {
    this.textsLayer?.querySelectorAll('.board-text').forEach((el) => {
      el.classList.toggle('selected', (el as HTMLElement).dataset.textId === selectedTextId);
    });
  }

  destroy(): void {
    this.layer?.remove();
    this.layer = null;
    this.strokesSvg = null;
    this.textsLayer = null;
    this.problemEl = null;
    this.liveStrokeEl = null;
  }
}

function renderProblemFrame(): string {
  const legend = REQUEST_COLORS.map(
    (color, i) =>
      `<span class="problem-legend-dot ${CELEBRITY_INDICES.includes(i) ? 'celebrity' : ''}" style="background:${color}" title="URL type ${i + 1}"></span>`
  ).join('');

  return `
    <div class="problem-frame-inner">
      <p class="problem-kicker">System design interview</p>
      <h2 class="problem-title">${SCENARIO.title}</h2>
      <p class="problem-duration">${SCENARIO.duration}s simulation · ${SCENARIO.baseRps} RPS base · spikes up to ${Math.round(SCENARIO.baseRps * SCENARIO.spikeMultiplier)} RPS</p>
      <h3 class="problem-heading">Requirements</h3>
      <ul class="problem-requirements">
        ${SCENARIO.requirements.map((r) => `<li>${r}</li>`).join('')}
      </ul>
      <h3 class="problem-heading">Request colors</h3>
      <div class="problem-legend">${legend}</div>
      <p class="problem-hint">Purple, pink &amp; gold = viral celebrity links</p>
      <p class="problem-hint subtle">Place components on the board, wire ports, configure scaling, then press Play.</p>
    </div>
  `;
}
