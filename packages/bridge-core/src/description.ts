// Provider formatters for the Fairlead technical block and the update-flow merge.
// Connectors call these so the marker logic lives in one place. Merge decision
// (plan 07, B6): content outside the Fairlead block is preserved as the tracker
// holds it; the envelope `description` replaces that prose only when its text
// differs from what is already there. The block itself is always replaced, never
// appended a second time.

export const TECHNICAL_HEADING = 'Fairlead technical context';
export const BLOCK_BEGIN = '<!-- fairlead:begin -->';
export const BLOCK_END = '<!-- fairlead:end -->';

/** Report-derived facts rendered into the block; independent of any provider format. */
export interface TechnicalContext {
  url: string;
  startedAt: string;
  stoppedAt: string;
  userActions: number;
  networkRequests: number;
  errors: number;
}

export interface AdfNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: AdfNode[];
  text?: string;
}
export interface AdfDocument {
  version: 1;
  type: 'doc';
  content: AdfNode[];
}

function contextLines(context: TechnicalContext | string): string[] {
  if (typeof context === 'string') return context.split('\n');
  return [
    `URL: ${context.url}`,
    `Recorded: ${context.startedAt} – ${context.stoppedAt}`,
    `User actions: ${context.userActions}`,
    `Network requests: ${context.networkRequests}`,
    `Errors: ${context.errors}`,
  ];
}
function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
function htmlText(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}
function paragraphs(text: string): string[] {
  return text.split(/\n\n+/).filter((paragraph) => paragraph.trim() !== '');
}

/** Removes a previously written Fairlead block, returning the prose around it. */
function withoutBlock(existing: string): string {
  const begin = existing.indexOf(BLOCK_BEGIN);
  const end = begin < 0 ? -1 : existing.indexOf(BLOCK_END, begin);
  if (begin < 0 || end < 0) return existing.trim();
  return (existing.slice(0, begin) + existing.slice(end + BLOCK_END.length)).trim();
}
function mergeMarked(
  existing: string,
  description: string,
  block: string,
  format: { prose: (text: string) => string; plain: (text: string) => string },
): string {
  const current = withoutBlock(existing);
  const keep =
    description.trim() === '' || normalize(format.plain(current)) === normalize(description);
  return [keep ? current : format.prose(description), block].filter(Boolean).join('\n\n');
}

/** GitHub: `existing` is the issue body; pass '' when creating. */
export function mergeMarkdown(
  existing: string,
  description: string,
  context: TechnicalContext | string,
): string {
  const block = [
    BLOCK_BEGIN,
    '---',
    `## ${TECHNICAL_HEADING}`,
    contextLines(context)
      .map((line) => `- ${line}`)
      .join('\n'),
    BLOCK_END,
  ].join('\n\n');
  return mergeMarked(existing, description, block, { prose: (text) => text, plain: (t) => t });
}

/** Azure DevOps: `existing` is the System.Description HTML; pass '' when creating. */
export function mergeHtml(
  existing: string,
  description: string,
  context: TechnicalContext | string,
): string {
  const items = contextLines(context)
    .map((line) => `<li>${escapeHtml(line)}</li>`)
    .join('');
  const block = `${BLOCK_BEGIN}<hr><h2>${TECHNICAL_HEADING}</h2><ul>${items}</ul>${BLOCK_END}`;
  return mergeMarked(existing, description, block, {
    prose: (text) =>
      paragraphs(text)
        .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`)
        .join(''),
    plain: htmlText,
  });
}

const INLINE_TYPES = new Set(['text', 'hardBreak', 'mention', 'emoji', 'inlineCard', 'status']);
function adfText(node: AdfNode): string {
  if (node.type === 'text') return node.text ?? '';
  if (node.type === 'hardBreak') return ' ';
  const children = node.content ?? [];
  return children.map(adfText).join(children.every((c) => INLINE_TYPES.has(c.type)) ? '' : ' ');
}
function isAdfDocument(value: unknown): value is AdfDocument {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as AdfDocument).type === 'doc' &&
    Array.isArray((value as AdfDocument).content)
  );
}
function isFairleadBlock(node: AdfNode): boolean {
  const first = node.content?.[0];
  return node.type === 'panel' && first?.type === 'heading' && adfText(first) === TECHNICAL_HEADING;
}
const textNode = (text: string): AdfNode => ({ type: 'text', text });
/** A paragraph's lines joined by hard breaks, so single newlines survive in Jira. */
function inlineNodes(paragraph: string): AdfNode[] {
  return paragraph
    .split('\n')
    .flatMap((line, index) => [
      ...(index > 0 ? [{ type: 'hardBreak' }] : []),
      ...(line ? [textNode(line)] : []),
    ]);
}

/**
 * Jira: `existing` is the issue's ADF description (or null/absent when creating
 * or when the issue has none). Nodes outside the Fairlead panel are kept as-is.
 */
export function mergeAdf(
  existing: unknown,
  description: string,
  context: TechnicalContext | string,
): AdfDocument {
  const doc: AdfDocument = isAdfDocument(existing)
    ? existing
    : { version: 1, type: 'doc', content: [] };
  const prose = doc.content.filter((node) => !isFairleadBlock(node));
  const keep =
    description.trim() === '' || normalize(prose.map(adfText).join(' ')) === normalize(description);
  const block: AdfNode = {
    type: 'panel',
    attrs: { panelType: 'info' },
    content: [
      { type: 'heading', attrs: { level: 2 }, content: [textNode(TECHNICAL_HEADING)] },
      {
        type: 'bulletList',
        content: contextLines(context).map((line) => ({
          type: 'listItem',
          content: [{ type: 'paragraph', content: [textNode(line)] }],
        })),
      },
    ],
  };
  const body: AdfNode[] = keep
    ? prose
    : paragraphs(description).map((paragraph) => ({
        type: 'paragraph',
        content: inlineNodes(paragraph),
      }));
  return { ...doc, version: 1, type: 'doc', content: [...body, block] };
}
