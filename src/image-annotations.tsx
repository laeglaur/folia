import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { Editor } from '@tiptap/react';
import { ArrowRight, Circle, Highlighter, Minus, Pencil, Redo2, Save, Square, Trash2, Type, Undo2, X, type LucideIcon } from 'lucide-react';

export type ImageAnnotationKind = 'rect' | 'ellipse' | 'line' | 'arrow' | 'pen' | 'text';
export type ImageAnnotationStyle = 'stroke' | 'highlight';

export type ImageAnnotation = {
  id: string;
  kind: ImageAnnotationKind;
  style: ImageAnnotationStyle;
  color: string;
  strokeWidth: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  points?: Array<[number, number]>;
  text?: string;
  fontSize?: number;
};

export type ImageAnnotationDocument = {
  version: 1;
  items: ImageAnnotation[];
};

export type ImageAnnotationEditRequest = {
  editor: Editor;
  pos: number;
  src: string;
  alt?: string;
  annotations: ImageAnnotationDocument;
  target?: { kind: 'composer'; pageId: string } | { kind: 'block' | 'card'; blockId: string };
};

type AnnotationTool = ImageAnnotationKind;
type ResizeHandle = 'nw' | 'ne' | 'sw' | 'se';
type AnnotationBounds = { x: number; y: number; width: number; height: number };
type TextDraft = { x: number; y: number; value: string; fontSize: number };

const defaultAnnotationDocument = (): ImageAnnotationDocument => ({ version: 1, items: [] });

export const parseImageAnnotations = (value: unknown): ImageAnnotationDocument => {
  if (!value || typeof value !== 'string') return defaultAnnotationDocument();
  try {
    const parsed = JSON.parse(value) as Partial<ImageAnnotationDocument>;
    if (parsed.version !== 1 || !Array.isArray(parsed.items)) return defaultAnnotationDocument();
    return {
      version: 1,
      items: parsed.items.filter((item): item is ImageAnnotation => Boolean(item && typeof item.id === 'string' && typeof item.kind === 'string'))
    };
  } catch {
    return defaultAnnotationDocument();
  }
};

export const serializeImageAnnotations = (document: ImageAnnotationDocument) => {
  const items = document.items.filter((item) => item.kind === 'text' ? Boolean(item.text?.trim()) : true);
  return items.length ? JSON.stringify({ version: 1, items }) : '';
};

const clampPoint = (value: number) => Math.max(0, Math.min(1, value));

const pointFromEvent = (event: ReactPointerEvent<SVGSVGElement>): [number, number] => {
  const rect = event.currentTarget.getBoundingClientRect();
  return [
    clampPoint((event.clientX - rect.left) / Math.max(1, rect.width)),
    clampPoint((event.clientY - rect.top) / Math.max(1, rect.height))
  ];
};

const clientPointFromEvent = (event: ReactPointerEvent<SVGSVGElement>): [number, number] => [event.clientX, event.clientY];

const pointDistance = ([x1, y1]: [number, number], [x2, y2]: [number, number]) => Math.hypot(x2 - x1, y2 - y1);

const clientDistance = ([x1, y1]: [number, number], [x2, y2]: [number, number]) => Math.hypot(x2 - x1, y2 - y1);

const annotationColor = (annotation: ImageAnnotation) => annotation.color || '#ff4d4f';
const annotationWidth = (annotation: ImageAnnotation) => Math.max(1, annotation.strokeWidth || 3);
const annotationOpacity = (annotation: ImageAnnotation) => annotation.style === 'highlight' ? 0.34 : 1;
const annotationStrokeOpacity = (annotation: ImageAnnotation) => annotation.style === 'highlight' ? 0.52 : 1;
const annotationFillOpacity = (annotation: ImageAnnotation) => annotation.style === 'highlight' ? 0.34 : 0;
const annotationFontSize = (annotation: ImageAnnotation) => Math.max(12, Math.min(48, annotation.fontSize ?? 18));

const draftElementRatio = (element: HTMLTextAreaElement | null, axis: 'width' | 'height', origin: number) => {
  if (!element) return undefined;
  const parent = element.offsetParent instanceof HTMLElement ? element.offsetParent : null;
  const parentSize = axis === 'width' ? parent?.clientWidth : parent?.clientHeight;
  const ownSize = axis === 'width' ? element.offsetWidth : element.offsetHeight;
  const ratio = ownSize / Math.max(1, parentSize ?? ownSize);
  return Math.max(0.04, Math.min(Math.max(0.04, 0.98 - origin), ratio));
};

const rectBounds = (annotation: ImageAnnotation): AnnotationBounds => {
  const x = annotation.x ?? Math.min(annotation.x1 ?? 0, annotation.x2 ?? 0);
  const y = annotation.y ?? Math.min(annotation.y1 ?? 0, annotation.y2 ?? 0);
  const width = annotation.width ?? Math.abs((annotation.x2 ?? x) - (annotation.x1 ?? x));
  const height = annotation.height ?? Math.abs((annotation.y2 ?? y) - (annotation.y1 ?? y));
  return { x, y, width, height };
};

const annotationBounds = (annotation: ImageAnnotation): AnnotationBounds => {
  if (annotation.kind === 'rect' || annotation.kind === 'ellipse') return rectBounds(annotation);
  if (annotation.kind === 'line' || annotation.kind === 'arrow') {
    const x1 = annotation.x1 ?? 0;
    const y1 = annotation.y1 ?? 0;
    const x2 = annotation.x2 ?? x1;
    const y2 = annotation.y2 ?? y1;
    return { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
  }
  if (annotation.kind === 'pen') {
    const points = annotation.points?.length ? annotation.points : [[0, 0] as [number, number]];
    const xs = points.map(([x]) => x);
    const ys = points.map(([, y]) => y);
    const left = Math.min(...xs);
    const top = Math.min(...ys);
    return { x: left, y: top, width: Math.max(...xs) - left, height: Math.max(...ys) - top };
  }
  const fontSize = annotationFontSize(annotation);
  const lines = (annotation.text || '').split('\n');
  const longestLine = Math.max(1, ...lines.map((line) => line.length));
  return {
    x: annotation.x ?? 0,
    y: annotation.y ?? 0,
    width: annotation.width ?? Math.max(0.08, longestLine * fontSize * 0.00085),
    height: annotation.height ?? Math.max(0.045, lines.length * fontSize * 0.0019)
  };
};

const handlePoints = (bounds: AnnotationBounds): Record<ResizeHandle, [number, number]> => ({
  nw: [bounds.x, bounds.y],
  ne: [bounds.x + bounds.width, bounds.y],
  sw: [bounds.x, bounds.y + bounds.height],
  se: [bounds.x + bounds.width, bounds.y + bounds.height]
});

const taperedArrowPath = (annotation: ImageAnnotation) => {
  const x1 = annotation.x1 ?? 0;
  const y1 = annotation.y1 ?? 0;
  const x2 = annotation.x2 ?? x1;
  const y2 = annotation.y2 ?? y1;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.hypot(dx, dy);
  if (length < 0.004) return '';
  const dirX = dx / length;
  const dirY = dy / length;
  const normalX = -dirY;
  const normalY = dirX;
  const base = Math.max(0.005, Math.min(0.028, annotationWidth(annotation) * 0.0026));
  const neckHalf = base * 0.9;
  const headHalf = base * 2.05;
  const headLength = Math.min(length * 0.34, base * 5.8);
  const neckX = x2 - dirX * headLength;
  const neckY = y2 - dirY * headLength;
  const points: Array<[number, number]> = [
    [x1, y1],
    [neckX + normalX * neckHalf, neckY + normalY * neckHalf],
    [neckX + normalX * headHalf, neckY + normalY * headHalf],
    [x2, y2],
    [neckX - normalX * headHalf, neckY - normalY * headHalf],
    [neckX - normalX * neckHalf, neckY - normalY * neckHalf]
  ].map(([x, y]) => [clampPoint(x), clampPoint(y)] as [number, number]);
  return points.map(([x, y], index) => `${index === 0 ? 'M' : 'L'} ${x} ${y}`).join(' ') + ' Z';
};

export function ImageAnnotationSvg({
  annotations,
  selectedId,
  interactive = false
}: {
  annotations: ImageAnnotationDocument;
  selectedId?: string | null;
  interactive?: boolean;
}) {
  return (
    <svg className="image-annotation-svg" viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden={!interactive}>
      {annotations.items.map((annotation) => {
        const color = annotationColor(annotation);
        const strokeWidth = annotationWidth(annotation);
        const common = {
          stroke: color,
          strokeWidth,
          strokeOpacity: annotationStrokeOpacity(annotation),
          vectorEffect: 'non-scaling-stroke' as const,
          className: selectedId === annotation.id ? 'is-selected' : undefined
        };
        if (annotation.kind === 'rect') {
          const bounds = rectBounds(annotation);
          return <rect key={annotation.id} {...bounds} {...common} fill={annotation.style === 'highlight' ? color : 'none'} fillOpacity={annotationFillOpacity(annotation)} />;
        }
        if (annotation.kind === 'ellipse') {
          const bounds = rectBounds(annotation);
          return <ellipse key={annotation.id} cx={bounds.x + bounds.width / 2} cy={bounds.y + bounds.height / 2} rx={bounds.width / 2} ry={bounds.height / 2} {...common} fill={annotation.style === 'highlight' ? color : 'none'} fillOpacity={annotationFillOpacity(annotation)} />;
        }
        if (annotation.kind === 'line' || annotation.kind === 'arrow') {
          if (annotation.kind === 'arrow') {
            return <path key={annotation.id} d={taperedArrowPath(annotation)} fill={color} fillOpacity={annotationOpacity(annotation)} className={selectedId === annotation.id ? 'is-selected' : undefined} />;
          }
          return <line key={annotation.id} x1={annotation.x1 ?? 0} y1={annotation.y1 ?? 0} x2={annotation.x2 ?? 0} y2={annotation.y2 ?? 0} {...common} strokeLinecap="round" />;
        }
        if (annotation.kind === 'pen') {
          const points = annotation.points ?? [];
          const d = points.map(([x, y], index) => `${index === 0 ? 'M' : 'L'} ${x} ${y}`).join(' ');
          return <path key={annotation.id} d={d} {...common} fill="none" strokeLinecap="round" strokeLinejoin="round" />;
        }
        return null;
      })}
      {interactive && selectedId ? (() => {
        const selected = annotations.items.find((annotation) => annotation.id === selectedId);
        if (!selected) return null;
        const bounds = annotationBounds(selected);
        const handles = selected.kind === 'text' ? [] : Object.entries(handlePoints(bounds));
        return (
          <g className="image-annotation-selection" pointerEvents="none">
            <rect x={bounds.x} y={bounds.y} width={bounds.width} height={bounds.height} fill="none" stroke="var(--accent)" strokeWidth={1} vectorEffect="non-scaling-stroke" strokeDasharray="4 3" />
            {handles.map(([handle, [x, y]]) => (
              <rect key={handle} x={x - 0.01} y={y - 0.01} width={0.02} height={0.02} rx={0.004} fill="var(--theme-surface-solid, #fff)" stroke="var(--accent)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
            ))}
          </g>
        );
      })() : null}
    </svg>
  );
}

export function ImageAnnotationTextLayer({
  annotations,
  selectedId
}: {
  annotations: ImageAnnotationDocument;
  selectedId?: string | null;
}) {
  const textItems = annotations.items.filter((annotation) => annotation.kind === 'text' && annotation.text?.trim());
  if (!textItems.length) return null;
  return (
    <div className="image-annotation-text-layer" aria-hidden="true">
      {textItems.map((annotation) => (
        <span
          key={annotation.id}
          className={`image-annotation-text-item ${selectedId === annotation.id ? 'is-selected' : ''}`}
          style={{
            left: `${(annotation.x ?? 0) * 100}%`,
            top: `${(annotation.y ?? 0) * 100}%`,
            width: annotation.width ? `${annotation.width * 100}%` : undefined,
            minWidth: annotation.width ? undefined : 'max-content',
            color: annotationColor(annotation),
            opacity: annotation.style === 'highlight' ? 0.72 : 1,
            fontSize: annotationFontSize(annotation)
          }}
        >
          {annotation.text}
        </span>
      ))}
    </div>
  );
}

export function annotatedImageHtml(src: string, alt: string, annotations: string, baseAttrs: Record<string, string> = {}) {
  const document = parseImageAnnotations(annotations);
  if (!document.items.length) return '';
  const attrs = Object.entries(baseAttrs)
    .filter(([, value]) => value)
    .map(([key, value]) => ` ${key}="${value.replace(/"/g, '&quot;')}"`)
    .join('');
  return `<span class="annotated-image" data-image-annotations="${annotations.replace(/"/g, '&quot;')}"${attrs}><img src="${src.replace(/"/g, '&quot;')}" alt="${alt.replace(/"/g, '&quot;')}">${annotationSvgString(document)}${annotationTextLayerString(document)}</span>`;
}

export const renderAnnotatedImagesInHtml = (html: string) => {
  if (!html || typeof document === 'undefined' || !html.includes('data-image-annotations')) return html;
  const container = document.createElement('div');
  container.innerHTML = html;
  container.querySelectorAll<HTMLImageElement>('img[data-image-annotations]').forEach((image) => {
    if (image.closest('.annotated-image')) return;
    const annotations = image.getAttribute('data-image-annotations') ?? '';
    const wrapperHtml = annotatedImageHtml(image.getAttribute('src') ?? '', image.getAttribute('alt') ?? '', annotations, {
      ...(image.getAttribute('data-width') ? { 'data-width': image.getAttribute('data-width') ?? '' } : {}),
      ...(image.getAttribute('data-indent') ? { 'data-indent': image.getAttribute('data-indent') ?? '' } : {}),
      ...(image.getAttribute('style') ? { style: image.getAttribute('style') ?? '' } : {})
    });
    if (!wrapperHtml) return;
    const template = document.createElement('template');
    template.innerHTML = wrapperHtml;
    const replacement = template.content.firstElementChild;
    if (replacement) image.replaceWith(replacement);
  });
  return container.innerHTML;
};

const annotationSvgString = (document: ImageAnnotationDocument) => {
  const shapes = document.items.map((annotation) => {
    const color = annotationColor(annotation);
    const width = annotationWidth(annotation);
    const opacity = annotationOpacity(annotation);
    if (annotation.kind === 'rect') {
      const bounds = rectBounds(annotation);
      return `<rect x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}" stroke="${color}" stroke-width="${width}" stroke-opacity="${annotationStrokeOpacity(annotation)}" vector-effect="non-scaling-stroke" fill="${annotation.style === 'highlight' ? color : 'none'}" fill-opacity="${annotationFillOpacity(annotation)}"/>`;
    }
    if (annotation.kind === 'ellipse') {
      const bounds = rectBounds(annotation);
      return `<ellipse cx="${bounds.x + bounds.width / 2}" cy="${bounds.y + bounds.height / 2}" rx="${bounds.width / 2}" ry="${bounds.height / 2}" stroke="${color}" stroke-width="${width}" stroke-opacity="${annotationStrokeOpacity(annotation)}" vector-effect="non-scaling-stroke" fill="${annotation.style === 'highlight' ? color : 'none'}" fill-opacity="${annotationFillOpacity(annotation)}"/>`;
    }
    if (annotation.kind === 'line' || annotation.kind === 'arrow') {
      if (annotation.kind === 'arrow') {
        return `<path d="${taperedArrowPath(annotation)}" fill="${color}" fill-opacity="${annotationOpacity(annotation)}"/>`;
      }
      return `<line x1="${annotation.x1 ?? 0}" y1="${annotation.y1 ?? 0}" x2="${annotation.x2 ?? 0}" y2="${annotation.y2 ?? 0}" stroke="${color}" stroke-width="${width}" stroke-opacity="${annotationStrokeOpacity(annotation)}" vector-effect="non-scaling-stroke" stroke-linecap="round"/>`;
    }
    if (annotation.kind === 'pen') {
      const d = (annotation.points ?? []).map(([x, y], index) => `${index === 0 ? 'M' : 'L'} ${x} ${y}`).join(' ');
      return `<path d="${d}" stroke="${color}" stroke-width="${width}" vector-effect="non-scaling-stroke" opacity="${opacity}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
    }
    return '';
  }).join('');
  return `<svg class="image-annotation-svg" viewBox="0 0 1 1" preserveAspectRatio="none">${shapes}</svg>`;
};

const escapeText = (value: string) => value.replace(/[<&]/g, (match) => match === '<' ? '&lt;' : '&amp;');

const annotationTextLayerString = (document: ImageAnnotationDocument) => {
  const items = document.items
    .filter((annotation) => annotation.kind === 'text' && annotation.text?.trim())
    .map((annotation) => {
      const width = annotation.width ? ` width: ${annotation.width * 100}%;` : '';
      return `<span class="image-annotation-text-item" style="left: ${(annotation.x ?? 0) * 100}%; top: ${(annotation.y ?? 0) * 100}%;${width} color: ${annotationColor(annotation)}; opacity: ${annotation.style === 'highlight' ? 0.72 : 1}; font-size: ${annotationFontSize(annotation)}px;">${escapeText(annotation.text ?? '')}</span>`;
    })
    .join('');
  return items ? `<span class="image-annotation-text-layer" aria-hidden="true">${items}</span>` : '';
};

const makeId = () => `anno_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
const minDrawDistance = 0.006;
const moveStartThresholdPx = 4;

const moveAnnotation = (annotation: ImageAnnotation, dx: number, dy: number): ImageAnnotation => ({
  ...annotation,
  ...(annotation.x !== undefined ? { x: clampPoint(annotation.x + dx) } : {}),
  ...(annotation.y !== undefined ? { y: clampPoint(annotation.y + dy) } : {}),
  ...(annotation.x1 !== undefined ? { x1: clampPoint(annotation.x1 + dx) } : {}),
  ...(annotation.y1 !== undefined ? { y1: clampPoint(annotation.y1 + dy) } : {}),
  ...(annotation.x2 !== undefined ? { x2: clampPoint(annotation.x2 + dx) } : {}),
  ...(annotation.y2 !== undefined ? { y2: clampPoint(annotation.y2 + dy) } : {}),
  ...(annotation.points ? { points: annotation.points.map(([x, y]) => [clampPoint(x + dx), clampPoint(y + dy)] as [number, number]) } : {})
});

const resizeBounds = (bounds: AnnotationBounds, handle: ResizeHandle, point: [number, number]): AnnotationBounds => {
  const right = bounds.x + bounds.width;
  const bottom = bounds.y + bounds.height;
  const left = handle.includes('w') ? point[0] : bounds.x;
  const top = handle.includes('n') ? point[1] : bounds.y;
  const nextRight = handle.includes('e') ? point[0] : right;
  const nextBottom = handle.includes('s') ? point[1] : bottom;
  const x = Math.min(left, nextRight);
  const y = Math.min(top, nextBottom);
  return {
    x,
    y,
    width: Math.max(0.002, Math.abs(nextRight - left)),
    height: Math.max(0.002, Math.abs(nextBottom - top))
  };
};

const scalePointIntoBounds = (point: [number, number], from: AnnotationBounds, to: AnnotationBounds): [number, number] => {
  const xRatio = from.width <= 0.002 ? 0 : (point[0] - from.x) / from.width;
  const yRatio = from.height <= 0.002 ? 0 : (point[1] - from.y) / from.height;
  return [clampPoint(to.x + xRatio * to.width), clampPoint(to.y + yRatio * to.height)];
};

const resizeAnnotation = (annotation: ImageAnnotation, handle: ResizeHandle, point: [number, number], originalBounds: AnnotationBounds): ImageAnnotation => {
  const nextBounds = resizeBounds(originalBounds, handle, point);
  if (annotation.kind === 'rect' || annotation.kind === 'ellipse') {
    return { ...annotation, x: nextBounds.x, y: nextBounds.y, width: nextBounds.width, height: nextBounds.height, x1: undefined, y1: undefined, x2: undefined, y2: undefined };
  }
  if (annotation.kind === 'line' || annotation.kind === 'arrow') {
    const [x1, y1] = scalePointIntoBounds([annotation.x1 ?? 0, annotation.y1 ?? 0], originalBounds, nextBounds);
    const [x2, y2] = scalePointIntoBounds([annotation.x2 ?? 0, annotation.y2 ?? 0], originalBounds, nextBounds);
    return { ...annotation, x1, y1, x2, y2 };
  }
  if (annotation.kind === 'pen') {
    return { ...annotation, points: (annotation.points ?? []).map((pointValue) => scalePointIntoBounds(pointValue, originalBounds, nextBounds)) };
  }
  return annotation;
};

const annotationIsMeaningful = (annotation: ImageAnnotation) => {
  if (annotation.kind === 'text') return Boolean(annotation.text?.trim());
  if (annotation.kind === 'pen') {
    const points = annotation.points ?? [];
    if (points.length < 2) return false;
    return pointDistance(points[0], points[points.length - 1]) >= minDrawDistance;
  }
  if (annotation.kind === 'rect' || annotation.kind === 'ellipse') {
    const bounds = rectBounds(annotation);
    return bounds.width >= minDrawDistance && bounds.height >= minDrawDistance;
  }
  const x1 = annotation.x1 ?? 0;
  const y1 = annotation.y1 ?? 0;
  const x2 = annotation.x2 ?? x1;
  const y2 = annotation.y2 ?? y1;
  return pointDistance([x1, y1], [x2, y2]) >= minDrawDistance;
};

export function ImageAnnotationEditor({
  request,
  onSave,
  onClose
}: {
  request: ImageAnnotationEditRequest | null;
  onSave: (request: ImageAnnotationEditRequest, annotations: ImageAnnotationDocument) => void;
  onClose: () => void;
}) {
  const [tool, setTool] = useState<AnnotationTool>('rect');
  const [style, setStyle] = useState<ImageAnnotationStyle>('stroke');
  const [color, setColor] = useState('#ff4d4f');
  const [strokeWidth, setStrokeWidth] = useState(4);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [history, setHistory] = useState<ImageAnnotationDocument[]>([defaultAnnotationDocument()]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const historyIndexRef = useRef(0);
  const annotationsRef = useRef<ImageAnnotationDocument>(defaultAnnotationDocument());
  const draftRef = useRef<ImageAnnotation | null>(null);
  const [previewAnnotation, setPreviewAnnotation] = useState<ImageAnnotation | null>(null);
  const [textDraft, setTextDraftState] = useState<TextDraft | null>(null);
  const textDraftRef = useRef<TextDraft | null>(null);
  const textInputRef = useRef<HTMLTextAreaElement | null>(null);
  const textDraftCommittedRef = useRef(false);
  const previewAnnotationRef = useRef<ImageAnnotation | null>(null);
  const moveRef = useRef<{ id: string; start: [number, number]; startClient: [number, number]; original: ImageAnnotation; active: boolean } | null>(null);
  const resizeRef = useRef<{ id: string; handle: ResizeHandle; original: ImageAnnotation; bounds: AnnotationBounds } | null>(null);

  const annotations = history[historyIndex] ?? defaultAnnotationDocument();
  annotationsRef.current = annotations;
  historyIndexRef.current = historyIndex;
  const visibleAnnotations = previewAnnotation
    ? {
      version: 1 as const,
      items: annotations.items.some((item) => item.id === previewAnnotation.id)
        ? annotations.items.map((item) => item.id === previewAnnotation.id ? previewAnnotation : item)
        : [...annotations.items, previewAnnotation]
    }
    : annotations;

  const setTextDraft = (draft: TextDraft | null) => {
    textDraftRef.current = draft;
    setTextDraftState(draft);
  };

  const commit = (next: ImageAnnotationDocument) => {
    const baseIndex = historyIndexRef.current;
    annotationsRef.current = next;
    historyIndexRef.current = baseIndex + 1;
    setHistory((current) => [...current.slice(0, baseIndex + 1), next]);
    setHistoryIndex(baseIndex + 1);
    return next;
  };

  const clearTransientState = () => {
    setPreviewAnnotation(null);
    setTextDraft(null);
    textDraftCommittedRef.current = false;
    previewAnnotationRef.current = null;
    draftRef.current = null;
    moveRef.current = null;
    resizeRef.current = null;
  };

  const undo = () => {
    clearTransientState();
    setSelectedId(null);
    setHistoryIndex((index) => {
      const nextIndex = Math.max(0, index - 1);
      historyIndexRef.current = nextIndex;
      annotationsRef.current = history[nextIndex] ?? defaultAnnotationDocument();
      return nextIndex;
    });
  };

  const redo = () => {
    clearTransientState();
    setSelectedId(null);
    setHistoryIndex((index) => {
      const nextIndex = Math.min(history.length - 1, index + 1);
      historyIndexRef.current = nextIndex;
      annotationsRef.current = history[nextIndex] ?? defaultAnnotationDocument();
      return nextIndex;
    });
  };

  const deleteAnnotationById = (id: string) => {
    clearTransientState();
    commit({ version: 1, items: annotations.items.filter((item) => item.id !== id) });
    setSelectedId(null);
  };

  const updateSelectedAnnotation = (changes: Partial<Pick<ImageAnnotation, 'color' | 'strokeWidth' | 'style' | 'fontSize'>>) => {
    if (!selectedId) return false;
    const selected = annotations.items.find((item) => item.id === selectedId);
    if (!selected) return false;
    const nextItem = { ...selected, ...changes };
    commit({ version: 1, items: annotations.items.map((item) => item.id === selectedId ? nextItem : item) });
    return true;
  };

  useEffect(() => {
    if (!request) return;
    setHistory([request.annotations]);
    setHistoryIndex(0);
    historyIndexRef.current = 0;
    annotationsRef.current = request.annotations;
    setSelectedId(null);
    setPreviewAnnotation(null);
    setTextDraft(null);
    textDraftCommittedRef.current = false;
    previewAnnotationRef.current = null;
    moveRef.current = null;
    resizeRef.current = null;
    draftRef.current = null;
  }, [request]);

  useEffect(() => {
    if (textDraft) textInputRef.current?.focus();
  }, [textDraft]);

  useEffect(() => {
    if (!selectedId) return;
    const selected = annotations.items.find((item) => item.id === selectedId);
    if (!selected) return;
    setColor(annotationColor(selected));
    setStrokeWidth(selected.kind === 'text' ? Math.round((annotationFontSize(selected) - 6) / 3) : annotationWidth(selected));
    setStyle(selected.style);
  }, [selectedId, annotations]);

  useEffect(() => {
    if (!request) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if ((event.key === 'Backspace' || event.key === 'Delete') && selectedId && !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLTextAreaElement)) {
        event.preventDefault();
        deleteAnnotationById(selectedId);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  const annotationAt = ([x, y]: [number, number]) => [...annotations.items].reverse().find((item) => {
    if (item.kind === 'text') return Math.abs((item.x ?? 0) - x) < 0.06 && Math.abs((item.y ?? 0) - y) < 0.04;
    const bounds = annotationBounds(item);
    return x >= bounds.x - 0.02 && x <= bounds.x + bounds.width + 0.02 && y >= bounds.y - 0.02 && y <= bounds.y + bounds.height + 0.02;
  });

  const resizeHandleAt = ([x, y]: [number, number]) => {
    if (!selectedId) return null;
    const selected = annotations.items.find((item) => item.id === selectedId);
    if (!selected || selected.kind === 'text') return null;
    const bounds = annotationBounds(selected);
    return Object.entries(handlePoints(bounds)).find(([, [handleX, handleY]]) => Math.abs(handleX - x) <= 0.025 && Math.abs(handleY - y) <= 0.025)?.[0] as ResizeHandle | undefined ?? null;
  };

  const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    event.preventDefault();
    const point = pointFromEvent(event);
    const startClient = clientPointFromEvent(event);
    if (tool === 'text') {
      const hit = annotationAt(point);
      if (hit) {
        commitTextDraft();
        setSelectedId(hit.id);
        moveRef.current = { id: hit.id, start: point, startClient, original: hit, active: false };
        event.currentTarget.setPointerCapture(event.pointerId);
        return;
      }
      clearTransientState();
      setSelectedId(null);
      textDraftCommittedRef.current = false;
      setTextDraft({ x: point[0], y: point[1], value: '', fontSize: Math.max(14, strokeWidth * 3 + 6) });
      return;
    }
    commitTextDraft();
    const selected = selectedId ? annotations.items.find((item) => item.id === selectedId) : null;
    const handle = resizeHandleAt(point);
    if (selected && handle) {
      resizeRef.current = { id: selected.id, handle, original: selected, bounds: annotationBounds(selected) };
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    const hit = annotationAt(point);
    if (hit) {
      setSelectedId(hit.id);
      moveRef.current = { id: hit.id, start: point, startClient, original: hit, active: false };
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    setSelectedId(null);
    const base: ImageAnnotation = {
      id: makeId(),
      kind: tool,
      style,
      color,
      strokeWidth
    };
    setTextDraft(null);
    draftRef.current = tool === 'pen'
      ? { ...base, points: [point] }
      : { ...base, x1: point[0], y1: point[1], x2: point[0], y2: point[1] };
    previewAnnotationRef.current = draftRef.current;
    setPreviewAnnotation(draftRef.current);
    setSelectedId(draftRef.current.id);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const draft = draftRef.current;
    const point = pointFromEvent(event);
    if (resizeRef.current) {
      const resized = resizeAnnotation(resizeRef.current.original, resizeRef.current.handle, point, resizeRef.current.bounds);
      previewAnnotationRef.current = resized;
      setPreviewAnnotation(resized);
      return;
    }
    if (moveRef.current) {
      if (!moveRef.current.active) {
        if (clientDistance(moveRef.current.startClient, clientPointFromEvent(event)) < moveStartThresholdPx) return;
        moveRef.current.active = true;
      }
      const [startX, startY] = moveRef.current.start;
      const moved = moveAnnotation(moveRef.current.original, point[0] - startX, point[1] - startY);
      previewAnnotationRef.current = moved;
      setPreviewAnnotation(moved);
      return;
    }
    if (!draft) return;
    const next = draft.kind === 'pen'
      ? { ...draft, points: [...(draft.points ?? []), point] }
      : { ...draft, x2: point[0], y2: point[1] };
    draftRef.current = next;
    previewAnnotationRef.current = next;
    setPreviewAnnotation(next);
  };

  const onPointerUp = (event: ReactPointerEvent<SVGSVGElement>) => {
    const draft = draftRef.current;
    if (draft) {
      if (annotationIsMeaningful(draft)) {
        commit({ version: 1, items: [...annotationsRef.current.items, draft] });
        setSelectedId(draft.id);
      } else {
        setSelectedId(null);
      }
      setPreviewAnnotation(null);
      previewAnnotationRef.current = null;
    }
    if (resizeRef.current && previewAnnotationRef.current) {
      const moved = previewAnnotationRef.current;
      commit({ version: 1, items: annotationsRef.current.items.map((item) => item.id === resizeRef.current?.id ? moved : item) });
      setSelectedId(moved.id);
      setPreviewAnnotation(null);
      previewAnnotationRef.current = null;
    }
    if (moveRef.current?.active && previewAnnotationRef.current) {
      const moved = previewAnnotationRef.current;
      commit({ version: 1, items: annotationsRef.current.items.map((item) => item.id === moveRef.current?.id ? moved : item) });
      setSelectedId(moved.id);
      setPreviewAnnotation(null);
      previewAnnotationRef.current = null;
    }
    moveRef.current = null;
    resizeRef.current = null;
    draftRef.current = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Pointer capture may already be released by the browser.
    }
  };

  const deleteSelected = () => {
    if (!selectedId) return;
    deleteAnnotationById(selectedId);
  };

  const commitTextDraft = () => {
    if (textDraftCommittedRef.current) return annotationsRef.current;
    textDraftCommittedRef.current = true;
    const draft = textDraftRef.current;
    const value = (textInputRef.current?.value ?? draft?.value ?? '').trim();
    if (!draft || !value) {
      setTextDraft(null);
      textDraftCommittedRef.current = false;
      return annotationsRef.current;
    }
    const next: ImageAnnotation = {
      id: makeId(),
      kind: 'text',
      style,
      color,
      strokeWidth,
      x: draft.x,
      y: draft.y,
      width: draftElementRatio(textInputRef.current, 'width', draft.x),
      height: draftElementRatio(textInputRef.current, 'height', draft.y),
      fontSize: draft.fontSize,
      text: value
    };
    const nextDocument = commit({ version: 1, items: [...annotationsRef.current.items, next] });
    setSelectedId(next.id);
    setTextDraft(null);
    textDraftCommittedRef.current = false;
    return nextDocument;
  };

  const saveAnnotations = () => {
    if (!request) return;
    const document = commitTextDraft();
    onSave(request, document);
  };

  const tools: Array<[AnnotationTool, LucideIcon, string]> = [
    ['rect', Square, 'Rectangle'],
    ['ellipse', Circle, 'Ellipse'],
    ['line', Minus, 'Line'],
    ['arrow', ArrowRight, 'Arrow'],
    ['pen', Pencil, 'Pen'],
    ['text', Type, 'Text']
  ];

  if (!request) return null;

  return (
    <div className="image-annotation-backdrop" role="dialog" aria-modal="true" aria-label="Edit image annotations">
      <div className="image-annotation-dialog">
        <div className="image-annotation-toolbar">
          {tools.map(([id, Icon, label]) => (
            <button
              key={id}
              type="button"
              className={tool === id ? 'is-active' : ''}
              onClick={() => {
                commitTextDraft();
                setTool(id);
                if (id === 'text') {
                  draftRef.current = null;
                  previewAnnotationRef.current = null;
                  setPreviewAnnotation(null);
                }
              }}
              title={label}
              aria-label={label}
            ><Icon size={16} /></button>
          ))}
          <button
            type="button"
            className={style === 'highlight' ? 'is-active' : ''}
            onClick={() => {
              const nextStyle = style === 'highlight' ? 'stroke' : 'highlight';
              setStyle(nextStyle);
              updateSelectedAnnotation({ style: nextStyle });
            }}
            title="Highlight style"
            aria-label="Highlight style"
          ><Highlighter size={16} /></button>
          <input
            type="color"
            value={color}
            onChange={(event) => {
              const nextColor = event.target.value;
              setColor(nextColor);
              updateSelectedAnnotation({ color: nextColor });
            }}
            aria-label="Annotation color"
          />
          <input
            type="range"
            min="1"
            max="12"
            value={strokeWidth}
            onChange={(event) => {
              const nextWidth = Number(event.target.value);
              setStrokeWidth(nextWidth);
              const selected = selectedId ? annotations.items.find((item) => item.id === selectedId) : null;
              updateSelectedAnnotation(selected?.kind === 'text' ? { fontSize: Math.max(12, nextWidth * 3 + 6) } : { strokeWidth: nextWidth });
            }}
            aria-label={selectedId && annotations.items.find((item) => item.id === selectedId)?.kind === 'text' ? 'Text size' : 'Stroke width'}
          />
          <button type="button" onClick={undo} disabled={historyIndex === 0} title="Undo" aria-label="Undo"><Undo2 size={16} /></button>
          <button type="button" onClick={redo} disabled={historyIndex >= history.length - 1} title="Redo" aria-label="Redo"><Redo2 size={16} /></button>
          <button type="button" onClick={deleteSelected} disabled={!selectedId} title="Delete selected" aria-label="Delete selected"><Trash2 size={16} /></button>
          <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={saveAnnotations} title="Save" aria-label="Save"><Save size={16} /></button>
          <button type="button" onClick={onClose} title="Cancel" aria-label="Cancel"><X size={16} /></button>
        </div>
        <div className="image-annotation-stage">
          <div className="image-annotation-canvas">
            <img src={request.src} alt={request.alt ?? ''} draggable={false} />
            <ImageAnnotationSvg annotations={visibleAnnotations} selectedId={selectedId} interactive />
            <ImageAnnotationTextLayer annotations={visibleAnnotations} selectedId={selectedId} />
            <svg className={`image-annotation-hit-layer tool-${tool}`} viewBox="0 0 1 1" preserveAspectRatio="none" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} />
            {textDraft ? (
              <textarea
                ref={textInputRef}
                className="image-annotation-text-input"
                value={textDraft.value}
                rows={Math.max(1, textDraft.value.split('\n').length)}
                style={{ left: `${textDraft.x * 100}%`, top: `${textDraft.y * 100}%`, color, fontSize: textDraft.fontSize }}
                onChange={(event) => {
                  const draft = textDraftRef.current;
                  if (draft) setTextDraft({ ...draft, value: event.target.value });
                }}
                onBlur={commitTextDraft}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault();
                    commitTextDraft();
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    textDraftCommittedRef.current = false;
                    setTextDraft(null);
                  }
                }}
              />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
