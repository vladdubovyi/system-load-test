export interface DrawStroke {
  id: string;
  points: { x: number; y: number }[];
  color: string;
  width: number;
}

export interface TextAnnotation {
  id: string;
  x: number;
  y: number;
  width: number;
  minHeight: number;
  content: string;
}

export interface BoardAnnotations {
  strokes: DrawStroke[];
  texts: TextAnnotation[];
}

export function createDefaultAnnotations(): BoardAnnotations {
  return { strokes: [], texts: [] };
}

export function strokeToPath(stroke: DrawStroke): string {
  if (stroke.points.length === 0) return '';
  const [first, ...rest] = stroke.points;
  let d = `M ${first.x} ${first.y}`;
  for (const point of rest) {
    d += ` L ${point.x} ${point.y}`;
  }
  return d;
}

export function createTextAnnotation(x: number, y: number): TextAnnotation {
  return {
    id: `text-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    x,
    y,
    width: 220,
    minHeight: 48,
    content: '',
  };
}

export function createStrokePoint(x: number, y: number): DrawStroke {
  return {
    id: `stroke-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    points: [{ x, y }],
    color: '#1e1e1e',
    width: 2.5,
  };
}
