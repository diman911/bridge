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

const conflict = <T>(
  message = 'the existing Fairlead block is malformed; retry with onConflict',
): DescriptionMergeResult<T> => ({
  ok: false,
  error: { code: 'description_conflict', message },
});

const REPLACE_NEEDS_DESCRIPTION =
  "onConflict 'replace' on a malformed Fairlead block requires a description to rewrite it";

function joinSections(...sections: (string | undefined)[]): string {
  return sections.filter((section) => section !== undefined && section !== '').join('\n\n');
}

function markdownBlock(value: string): string {
  // Fence must be longer than any backtick run in the value so it cannot close early.
  const longest = Math.max(0, ...(value.match(/`+/g) ?? []).map((run) => run.length));
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return `${fence}fairlead\n${value}\n${fence}`;
}

function locateMarkdownBlock(existing: string): LocatedBlock {
  const opener = /^(`{3,})fairlead[\t ]*\r?$/gm;
  const first = opener.exec(existing);
  if (!first) return { state: 'absent' };
  const fence = first[1];
  const start = first.index;
  const closing = new RegExp(`^\`{${fence.length},}[\t ]*\r?$`, 'gm');
  closing.lastIndex = start + first[0].length;
  const end = closing.exec(existing);
  if (!end) return { state: 'malformed' };
  const blockEnd = end.index + end[0].length;
  opener.lastIndex = blockEnd;
  if (opener.exec(existing)) return { state: 'malformed' };
  return { state: 'intact', start, end: blockEnd };
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

  if (block.state === 'malformed') {
    if (update.onConflict === 'replace') {
      if (renderedDescription === undefined) return conflict(REPLACE_NEEDS_DESCRIPTION);
      return { ok: true, value: joinSections(renderedDescription, renderedBlock) };
    }
    if (update.onConflict !== 'append') return conflict();
    return { ok: true, value: joinSections(existing.trim(), renderedBlock) };
  }

  // Only the block changes: keep it where the user has it.
  if (block.state === 'intact' && renderedDescription === undefined && renderedBlock !== undefined)
    return {
      ok: true,
      value: `${existing.slice(0, block.start)}${renderedBlock}${existing.slice(block.end)}`,
    };

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
  if (malformed) {
    if (update.onConflict === 'replace') {
      if (update.description === undefined) return conflict(REPLACE_NEEDS_DESCRIPTION);
      const content = [
        ...adfDescription(update.description),
        ...(update.technicalSection ? [adfBlock(update.technicalSection)] : []),
      ];
      return { ok: true, value: { version: 1, type: 'doc', content } };
    }
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
  if (indexes.length === 1 && update.description === undefined && update.technicalSection) {
    const content = doc.content.map((node, index) =>
      index === indexes[0] ? adfBlock(update.technicalSection as string) : node,
    );
    return { ok: true, value: { ...doc, version: 1, type: 'doc', content } };
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
