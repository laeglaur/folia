import { readFile } from 'node:fs/promises';

const imageAnnotations = await readFile(new URL('../src/image-annotations.tsx', import.meta.url), 'utf8');
const editor = await readFile(new URL('../src/editor.tsx', import.meta.url), 'utf8');
const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

const checks = {
  textLayerComponent: imageAnnotations.includes('export function ImageAnnotationTextLayer'),
  svgTextRemoved: !imageAnnotations.includes('<text key={annotation.id}') && imageAnnotations.includes('return null;'),
  textareaDraft: imageAnnotations.includes('<textarea') && imageAnnotations.includes('fontSize: Math.max(14, strokeWidth * 3 + 6)'),
  draftSizePersisted: imageAnnotations.includes('draftElementRatio') && imageAnnotations.includes('fontSize: draft.fontSize'),
  savedHtmlLayer: imageAnnotations.includes('annotationTextLayerString(document)'),
  editorRendersLayer: editor.includes('ImageAnnotationTextLayer') && editor.includes('<ImageAnnotationTextLayer annotations={annotations} />'),
  cssTextLayer: styles.includes('.image-annotation-text-layer') && styles.includes('.image-annotation-text-input')
};

console.log(JSON.stringify({ checks }, null, 2));

if (Object.values(checks).some((value) => !value)) {
  process.exit(1);
}
