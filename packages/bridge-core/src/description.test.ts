import { describe, expect, it } from 'vitest';
import { mergeAdf, mergeHtml, mergeMarkdown, type AdfDocument } from './description.js';

describe('managed Fairlead block', () => {
  it('replaces, appends, preserves, and removes the Markdown block', () => {
    const created = mergeMarkdown('User text', { technicalSection: 'old' });
    expect(created).toEqual({ ok: true, value: 'User text\n\n```fairlead\nold\n```' });
    if (!created.ok) return;
    expect(mergeMarkdown(created.value, { technicalSection: 'new' })).toEqual({
      ok: true,
      value: 'User text\n\n```fairlead\nnew\n```',
    });
    expect(mergeMarkdown(created.value, { description: 'Rewritten' })).toEqual({
      ok: true,
      value: 'Rewritten\n\n```fairlead\nold\n```',
    });
    expect(mergeMarkdown(created.value, { technicalSection: '' })).toEqual({
      ok: true,
      value: 'User text',
    });
  });

  it('detects malformed Markdown and applies both conflict strategies', () => {
    const malformed = 'User text\n\n```fairlead\nunclosed';
    expect(mergeMarkdown(malformed, { technicalSection: 'new' })).toMatchObject({
      ok: false,
      error: { code: 'description_conflict' },
    });
    expect(mergeMarkdown(malformed, { technicalSection: 'new', onConflict: 'append' })).toEqual({
      ok: true,
      value: `${malformed}\n\n\`\`\`fairlead\nnew\n\`\`\``,
    });
    expect(
      mergeMarkdown(malformed, {
        description: 'Clean prose',
        technicalSection: 'new',
        onConflict: 'replace',
      }),
    ).toEqual({ ok: true, value: 'Clean prose\n\n```fairlead\nnew\n```' });
    expect(mergeMarkdown(malformed, { description: 'Clean prose', onConflict: 'replace' })).toEqual(
      { ok: true, value: 'Clean prose' },
    );
  });

  it('uses an escaped HTML code block for Azure DevOps', () => {
    const created = mergeHtml('<p>User text</p>', { technicalSection: '<secret>' });
    expect(created).toEqual({
      ok: true,
      value: '<p>User text</p>\n\n<pre><code class="language-fairlead">&lt;secret&gt;</code></pre>',
    });
    if (!created.ok) return;
    expect(mergeHtml(created.value, { technicalSection: '' })).toEqual({
      ok: true,
      value: '<p>User text</p>',
    });
    expect(
      mergeHtml('<pre><code class="language-fairlead">broken', { technicalSection: 'new' }),
    ).toMatchObject({ ok: false, error: { code: 'description_conflict' } });
  });

  it('preserves Jira ADF nodes while replacing or deleting its codeBlock', () => {
    const paragraph = { type: 'paragraph', content: [{ type: 'text', text: 'User text' }] };
    const doc: AdfDocument = {
      version: 1,
      type: 'doc',
      content: [
        paragraph,
        {
          type: 'codeBlock',
          attrs: { language: 'fairlead' },
          content: [{ type: 'text', text: 'old' }],
        },
      ],
    };
    expect(mergeAdf(doc, { technicalSection: 'new' })).toEqual({
      ok: true,
      value: {
        ...doc,
        content: [
          paragraph,
          {
            type: 'codeBlock',
            attrs: { language: 'fairlead' },
            content: [{ type: 'text', text: 'new' }],
          },
        ],
      },
    });
    expect(mergeAdf(doc, { technicalSection: '' })).toEqual({
      ok: true,
      value: { ...doc, content: [paragraph] },
    });
  });

  it('treats multiple Jira Fairlead blocks as malformed', () => {
    const block = {
      type: 'codeBlock',
      attrs: { language: 'fairlead' },
      content: [{ type: 'text', text: 'old' }],
    };
    const doc: AdfDocument = { version: 1, type: 'doc', content: [block, block] };
    expect(mergeAdf(doc, { technicalSection: 'new' })).toMatchObject({
      ok: false,
      error: { code: 'description_conflict' },
    });
    expect(mergeAdf(doc, { technicalSection: 'new', onConflict: 'append' })).toMatchObject({
      ok: true,
      value: { content: [block, block, expect.objectContaining({ type: 'codeBlock' })] },
    });
  });
});
