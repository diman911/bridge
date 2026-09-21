import { describe, expect, it } from 'vitest';
import { mergeAdf, mergeHtml, mergeMarkdown, type TechnicalContext } from './description.js';

const context: TechnicalContext = {
  url: 'https://app.example.test/<x>',
  startedAt: 'a',
  stoppedAt: 'b',
  userActions: 1,
  networkRequests: 2,
  errors: 3,
};
const count = (text: string, part: string) => text.split(part).length - 1;

describe('description merge', () => {
  it('markdown: replaces the block on re-update and keeps unchanged prose', () => {
    const created = mergeMarkdown('', 'Summary', context);
    const updated = mergeMarkdown(`${created}`, 'Summary', { ...context, errors: 9 });
    expect(count(updated, 'Fairlead technical context')).toBe(1);
    expect(updated).toContain('Errors: 9');
    expect(updated.startsWith('Summary')).toBe(true);
  });

  it('markdown: keeps tracker-side edits when the description is unchanged, replaces otherwise', () => {
    const existing = `Edited in tracker\n\n${mergeMarkdown('', '', context)}`;
    expect(mergeMarkdown(existing, '', context)).toContain('Edited in tracker');
    const replaced = mergeMarkdown(existing, 'New text', context);
    expect(replaced).toContain('New text');
    expect(replaced).not.toContain('Edited in tracker');
  });

  it('html: escapes report values and round-trips without duplicating the block', () => {
    const created = mergeHtml('', 'A & B', context);
    expect(created).toContain('&lt;x&gt;');
    expect(created).toContain('<p>A &amp; B</p>');
    const updated = mergeHtml(created, 'A & B', context);
    expect(count(updated, 'Fairlead technical context')).toBe(1);
    expect(updated).toBe(created);
  });

  it('adf: preserves rich existing nodes and replaces only the Fairlead panel', () => {
    const rich = {
      version: 1,
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Steps' }] },
        { type: 'codeBlock', content: [{ type: 'text', text: 'npm test' }] },
      ],
    };
    const first = mergeAdf(rich, '', context);
    const second = mergeAdf(first, '', { ...context, errors: 9 });
    expect(second.content).toHaveLength(3);
    expect(second.content.slice(0, 2)).toEqual(rich.content);
    expect(JSON.stringify(second)).toContain('Errors: 9');
    expect(count(JSON.stringify(second), 'Fairlead technical context')).toBe(1);
  });

  it('adf: keeps single newlines as hard breaks', () => {
    const doc = mergeAdf(null, 'one\ntwo\n\nthree', context);
    expect(doc.content[0].content).toEqual([
      { type: 'text', text: 'one' },
      { type: 'hardBreak' },
      { type: 'text', text: 'two' },
    ]);
    expect(doc.content[1].content).toEqual([{ type: 'text', text: 'three' }]);
    expect(mergeAdf(doc, 'one\ntwo\n\nthree', context).content).toHaveLength(3);
  });

  it('adf: builds a document when the issue has no description', () => {
    expect(mergeAdf(null, 'Hello', context).content[0]).toMatchObject({ type: 'paragraph' });
  });
});
