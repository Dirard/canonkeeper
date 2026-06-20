import type { JSONContent } from '@tiptap/core';

export type DraftBlockKind = 'paragraph' | 'heading' | 'quote' | 'list_item' | 'scene_break';

export interface DraftMarkdownBlock {
  kind: DraftBlockKind;
  markdown: string;
  text: string;
}

export function normalizeDraftMarkdown(markdown: string) {
  return markdown.replace(/\r\n?/g, '\n').trim();
}

export function draftMarkdownToBlocks(markdown: string): DraftMarkdownBlock[] {
  const source = normalizeDraftMarkdown(markdown);
  if (!source) return [];

  return source
    .split(/\n{2,}/)
    .flatMap((block) => {
      const normalizedBlock = block.trim();
      if (!normalizedBlock) return [];
      const listLines = normalizedBlock.split('\n').filter((line) => line.trim().startsWith('- '));
      if (listLines.length > 1 || (listLines.length === 1 && normalizedBlock.split('\n').length === 1)) {
        return listLines.map((line) => blockFromMarkdown(line.trim()));
      }
      return [blockFromMarkdown(normalizedBlock)];
    })
    .filter((block) => block.text.length > 0 || block.kind === 'scene_break');
}

export function draftMarkdownToPlainText(markdown: string) {
  return draftMarkdownToBlocks(markdown)
    .map((block) => block.text)
    .filter(Boolean)
    .join('\n\n');
}

export function draftMarkdownToHtml(markdown: string) {
  const blocks = draftMarkdownToBlocks(markdown);
  if (blocks.length === 0) return '<p></p>';

  const html: string[] = [];
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    if (!block) continue;
    if (block.kind === 'list_item') {
      const items: string[] = [];
      let listBlock = blocks[index];
      while (listBlock?.kind === 'list_item') {
        items.push(`<li><p>${inlineMarkdownToHtml(stripBlockSyntax(listBlock.markdown, 'list_item'))}</p></li>`);
        index += 1;
        listBlock = blocks[index];
      }
      index -= 1;
      html.push(`<ul>${items.join('')}</ul>`);
      continue;
    }
    if (block.kind === 'heading') {
      html.push(`<h2>${inlineMarkdownToHtml(stripBlockSyntax(block.markdown, 'heading'))}</h2>`);
    } else if (block.kind === 'quote') {
      html.push(`<blockquote><p>${inlineMarkdownToHtml(stripBlockSyntax(block.markdown, 'quote'))}</p></blockquote>`);
    } else if (block.kind === 'scene_break') {
      html.push('<hr>');
    } else {
      html.push(`<p>${inlineMarkdownToHtml(block.markdown)}</p>`);
    }
  }

  return html.join('');
}

export function editorJsonToDraftMarkdown(json: JSONContent) {
  if (json.type !== 'doc') return '';
  return (json.content ?? [])
    .map((node) => renderBlock(node))
    .filter(Boolean)
    .join('\n\n')
    .trim();
}

function blockFromMarkdown(markdown: string): DraftMarkdownBlock {
  if (/^---+$/.test(markdown)) {
    return { kind: 'scene_break', markdown: '---', text: '' };
  }
  if (markdown.startsWith('## ')) {
    return { kind: 'heading', markdown, text: inlineMarkdownToPlainText(markdown.slice(3)) };
  }
  if (markdown.startsWith('>')) {
    return { kind: 'quote', markdown, text: inlineMarkdownToPlainText(stripBlockSyntax(markdown, 'quote')) };
  }
  if (markdown.startsWith('- ')) {
    return { kind: 'list_item', markdown, text: inlineMarkdownToPlainText(markdown.slice(2)) };
  }
  return { kind: 'paragraph', markdown, text: inlineMarkdownToPlainText(markdown) };
}

function stripBlockSyntax(markdown: string, kind: DraftBlockKind) {
  if (kind === 'heading') return markdown.replace(/^##\s+/, '');
  if (kind === 'quote') return markdown.replace(/^>\s?/gm, '');
  if (kind === 'list_item') return markdown.replace(/^-\s+/, '');
  return markdown;
}

function inlineMarkdownToPlainText(markdown: string) {
  return markdown
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .trim();
}

function inlineMarkdownToHtml(markdown: string) {
  let html = escapeHtml(markdown);
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label: string, href: string) => {
    const safeHref = sanitizeHref(href);
    return safeHref ? `<a href="${escapeAttribute(safeHref)}">${label}</a>` : label;
  });
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  return html;
}

function renderBlock(node: JSONContent): string {
  if (node.type === 'paragraph') return renderInline(node).trim();
  if (node.type === 'heading') return `## ${renderInline(node).trim()}`.trim();
  if (node.type === 'blockquote') {
    return (node.content ?? [])
      .map((child) => renderBlock(child))
      .join('\n\n')
      .split('\n')
      .map((line) => `> ${line}`)
      .join('\n')
      .trim();
  }
  if (node.type === 'bulletList') {
    return (node.content ?? []).map((child) => renderListItem(child)).filter(Boolean).join('\n');
  }
  if (node.type === 'horizontalRule') return '---';
  return renderInline(node).trim();
}

function renderListItem(node: JSONContent) {
  const text = (node.content ?? []).map((child) => renderBlock(child)).filter(Boolean).join(' ').trim();
  return text ? `- ${text}` : '';
}

function renderInline(node: JSONContent): string {
  if (node.type === 'text') {
    return applyMarks(node.text ?? '', node.marks ?? []);
  }
  if (node.type === 'hardBreak') return '\n';
  return (node.content ?? []).map((child) => renderInline(child)).join('');
}

function applyMarks(text: string, marks: NonNullable<JSONContent['marks']>) {
  return marks.reduce((current, mark) => {
    if (mark.type === 'bold') return `**${current}**`;
    if (mark.type === 'italic') return `*${current}*`;
    if (mark.type === 'link') {
      const href = typeof mark.attrs?.href === 'string' ? sanitizeHref(mark.attrs.href) : '';
      return href ? `[${current}](${href})` : current;
    }
    return current;
  }, text);
}

function sanitizeHref(href: string) {
  return /^(https?:\/\/|canon:\/\/)/.test(href) ? href : '';
}

function escapeHtml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttribute(value: string) {
  return escapeHtml(value).replace(/"/g, '&quot;');
}
