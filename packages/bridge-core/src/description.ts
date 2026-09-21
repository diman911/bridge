export interface DescriptionUpdate {
  description?: string;
  technicalSection?: string;
  onConflict?: 'append' | 'replace';
}

export type DescriptionMergeResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      error: { code: 'description_conflict'; message: string };
    };

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

type LocatedBlock =
  { state: 'absent' } | { state: 'intact'; start: number; end: number } | { state: 'malformed' };

const conflict = <T>(): DescriptionMergeResult<T> => ({
  ok: false,
  error: {
    code: 'description_conflict',
    message: 'the existing Fairlead block is malformed; retry with onConflict',
  },
});

function joinSections(...sections: (string | undefined)[]): string {
  return sections.filter((section) => section !== undefined && section !== '').join('\n\n');
}

function markdownBlock(value: string): string {
  return `\`\`\`fairlead\n${value}\n\`\`\``;
}

function locateMarkdownBlock(existing: string): LocatedBlock {
  const opener = /^```fairlead[\t ]*\r?$/gm;
  const openings = [...existing.matchAll(opener)];
  if (openings.length === 0) return { state: 'absent' };
  if (openings.length !== 1) return { state: 'malformed' };
  const match = openings[0];
  const start = match.index;
  const contentStart = start + match[0].length;
  const closing = /^```[\t ]*\r?$/gm;
  closing.lastIndex = contentStart;
  const end = closing.exec(existing);
  if (!end) return { state: 'malformed' };
  return { state: 'intact', start, end: end.index + end[0].length };
}

function mergeTextBlock(
  existing: string,
  update: DescriptionUpdate,
  locate: (value: string) => LocatedBlock,
  renderBlock: (value: string) => string,
  renderDescription: (value: string) => string,
): DescriptionMergeResult<string> {
  const block = locate(existing);
  const renderedDescription =
    update.description === undefined ? undefined : renderDescription(update.description);
  const renderedBlock =
    update.technicalSection === undefined || update.technicalSection === ''
      ? undefined
      : renderBlock(update.technicalSection);

  if (update.onConflict === 'replace')
    return { ok: true, value: joinSections(renderedDescription, renderedBlock) };
  if (block.state === 'malformed') {
    if (update.onConflict !== 'append') return conflict();
    return { ok: true, value: joinSections(existing.trim(), renderedBlock) };
  }

  const prose =
    block.state === 'intact'
      ? `${existing.slice(0, block.start)}${existing.slice(block.end)}`.trim()
      : existing.trim();
  const nextProse = renderedDescription ?? prose;
  const nextBlock =
    update.technicalSection === undefined
      ? block.state === 'intact'
        ? existing.slice(block.start, block.end)
        : undefined
      : renderedBlock;
  return { ok: true, value: joinSections(nextProse, nextBlock) };
}

/** GitHub representation: a fenced Markdown block with info string `fairlead`. */
export function mergeMarkdown(
  existing: string,
  update: DescriptionUpdate,
): DescriptionMergeResult<string> {
  return mergeTextBlock(existing, update, locateMarkdownBlock, markdownBlock, (value) => value);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
function paragraphs(text: string): string {
  return text
    .split(/\n\n+/)
    .filter((paragraph) => paragraph.trim() !== '')
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`)
    .join('');
}
const HTML_OPEN = '<pre><code class="language-fairlead">';
const HTML_CLOSE = '</code></pre>';
function locateHtmlBlock(existing: string): LocatedBlock {
  const starts: number[] = [];
  for (
    let index = existing.indexOf(HTML_OPEN);
    index >= 0;
    index = existing.indexOf(HTML_OPEN, index + 1)
  )
    starts.push(index);
  if (starts.length === 0) return { state: 'absent' };
  if (starts.length !== 1) return { state: 'malformed' };
  const end = existing.indexOf(HTML_CLOSE, starts[0] + HTML_OPEN.length);
  return end < 0
    ? { state: 'malformed' }
    : { state: 'intact', start: starts[0], end: end + HTML_CLOSE.length };
}

/** Azure DevOps representation of the same managed Markdown block. */
export function mergeHtml(
  existing: string,
  update: DescriptionUpdate,
): DescriptionMergeResult<string> {
  return mergeTextBlock(
    existing,
    update,
    locateHtmlBlock,
    (value) => `${HTML_OPEN}${escapeHtml(value)}${HTML_CLOSE}`,
    paragraphs,
  );
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
  return node.type === 'codeBlock' && node.attrs?.language === 'fairlead';
}
const textNode = (text: string): AdfNode => ({ type: 'text', text });
function inlineNodes(paragraph: string): AdfNode[] {
  return paragraph
    .split('\n')
    .flatMap((line, index) => [
      ...(index > 0 ? [{ type: 'hardBreak' }] : []),
      ...(line ? [textNode(line)] : []),
    ]);
}
function adfDescription(value: string): AdfNode[] {
  return value
    .split(/\n\n+/)
    .filter((paragraph) => paragraph.trim() !== '')
    .map((paragraph) => ({ type: 'paragraph', content: inlineNodes(paragraph) }));
}
function adfBlock(value: string): AdfNode {
  return { type: 'codeBlock', attrs: { language: 'fairlead' }, content: [textNode(value)] };
}

/** Jira representation: one ADF codeBlock whose language is `fairlead`. */
export function mergeAdf(
  existing: unknown,
  update: DescriptionUpdate,
): DescriptionMergeResult<AdfDocument> {
  const doc: AdfDocument = isAdfDocument(existing)
    ? existing
    : { version: 1, type: 'doc', content: [] };
  const indexes = doc.content.flatMap((node, index) => (isFairleadBlock(node) ? [index] : []));
  const malformed = indexes.length > 1;
  if (update.onConflict === 'replace') {
    const content = [
      ...adfDescription(update.description ?? ''),
      ...(update.technicalSection ? [adfBlock(update.technicalSection)] : []),
    ];
    return { ok: true, value: { version: 1, type: 'doc', content } };
  }
  if (malformed) {
    if (update.onConflict !== 'append') return conflict();
    return {
      ok: true,
      value: {
        ...doc,
        content: [
          ...doc.content,
          ...(update.technicalSection ? [adfBlock(update.technicalSection)] : []),
        ],
      },
    };
  }
  const existingBlock = indexes.length === 1 ? doc.content[indexes[0]] : undefined;
  const prose = doc.content.filter((_, index) => index !== indexes[0]);
  const nextProse = update.description === undefined ? prose : adfDescription(update.description);
  const nextBlock =
    update.technicalSection === undefined
      ? existingBlock
      : update.technicalSection
        ? adfBlock(update.technicalSection)
        : undefined;
  return {
    ok: true,
    value: {
      ...doc,
      version: 1,
      type: 'doc',
      content: [...nextProse, ...(nextBlock ? [nextBlock] : [])],
    },
  };
}
