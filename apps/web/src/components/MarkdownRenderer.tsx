import React from 'react';

/**
 * 轻量级 Markdown 渲染器
 * 支持：标题(h1-h4)、加粗、斜体、表格、列表、引用块、代码块、分割线
 * 无需外部依赖，体积 ~2KB
 */

interface MarkdownRendererProps {
  content: string;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export default function MarkdownRenderer({ content }: MarkdownRendererProps) {
  if (!content) return null;

  const html = renderMarkdown(content);
  return (
    <div
      className="markdown-body"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function renderMarkdown(md: string): string {
  const lines = md.split('\n');
  let html = '';
  let inCodeBlock = false;
  let codeContent = '';
  let codeLang = '';
  let inTable = false;
  let tableHtml = '';
  let inList = false;
  let listType: 'ul' | 'ol' | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Code blocks
    if (line.startsWith('```')) {
      if (inCodeBlock) {
        html += `<pre><code class="language-${codeLang}">${escapeHtml(codeContent.trim())}</code></pre>`;
        codeContent = '';
        inCodeBlock = false;
        codeLang = '';
      } else {
        inCodeBlock = true;
        codeLang = line.slice(3).trim();
      }
      continue;
    }

    if (inCodeBlock) {
      codeContent += line + '\n';
      continue;
    }

    // Tables
    if (line.startsWith('|') && line.endsWith('|')) {
      if (!inTable) {
        inTable = true;
        tableHtml = '<table><thead><tr>';
        const headers = line.split('|').slice(1, -1).map(h => h.trim());
        for (const h of headers) tableHtml += `<th>${renderInline(h)}</th>`;
        tableHtml += '</tr></thead><tbody>';
        continue;
      }
      // Skip separator line (|---|---|)
      if (line.match(/^\|[\s\-:]+\|/)) continue;
      // Data row
      const cells = line.split('|').slice(1, -1).map(c => c.trim());
      tableHtml += '<tr>';
      for (const c of cells) tableHtml += `<td>${renderInline(c)}</td>`;
      tableHtml += '</tr>';
      continue;
    } else if (inTable) {
      tableHtml += '</tbody></table>';
      html += tableHtml;
      tableHtml = '';
      inTable = false;
      // Fall through to handle this line normally
    }

    // Empty line
    if (line.trim() === '') {
      if (inList) {
        html += `</${listType}>`;
        inList = false;
        listType = null;
      }
      continue;
    }

    // Headings
    const hMatch = line.match(/^(#{1,4})\s+(.+)$/);
    if (hMatch) {
      if (inList) { html += `</${listType}>`; inList = false; listType = null; }
      const level = hMatch[1].length;
      const text = renderInline(hMatch[2]);
      html += `<h${level}>${text}</h${level}>`;
      continue;
    }

    // Horizontal rule
    if (line.match(/^(---|\*\*\*|___)\s*$/)) {
      html += '<hr>';
      continue;
    }

    // Unordered list
    const ulMatch = line.match(/^(\s*)[-*+]\s+(.+)$/);
    if (ulMatch) {
      if (!inList || listType !== 'ul') {
        if (inList) html += `</${listType}>`;
        html += '<ul>';
        inList = true;
        listType = 'ul';
      }
      html += `<li>${renderInline(ulMatch[2])}</li>`;
      continue;
    }

    // Ordered list
    const olMatch = line.match(/^(\s*)\d+\.\s+(.+)$/);
    if (olMatch) {
      if (!inList || listType !== 'ol') {
        if (inList) html += `</${listType}>`;
        html += '<ol>';
        inList = true;
        listType = 'ol';
      }
      html += `<li>${renderInline(olMatch[2])}</li>`;
      continue;
    }

    // Blockquote
    const bqMatch = line.match(/^>\s*(.*)$/);
    if (bqMatch) {
      if (inList) { html += `</${listType}>`; inList = false; listType = null; }
      html += `<blockquote>${renderInline(bqMatch[1])}</blockquote>`;
      continue;
    }

    // Regular paragraph
    if (inList) { html += `</${listType}>`; inList = false; listType = null; }
    html += `<p>${renderInline(line)}</p>`;
  }

  // Close open elements
  if (inList) html += `</${listType}>`;
  if (inTable) {
    tableHtml += '</tbody></table>';
    html += tableHtml;
  }
  if (inCodeBlock) {
    html += `<pre><code>${escapeHtml(codeContent.trim())}</code></pre>`;
  }

  return html;
}

function renderInline(text: string): string {
  // Bold + Italic
  text = text.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  // Bold
  text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // Italic
  text = text.replace(/\*(.+?)\*/g, '<em>$1</em>');
  // Inline code
  text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
  // Images
  text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img alt="$1" src="$2" style="max-width:100%">');
  // Links
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  return text;
}
