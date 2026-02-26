import { describe, test, expect } from 'vitest';
import { createMarked } from './marked-config.js';

describe('createMarked', () => {
  const marked = createMarked();

  // ─── Markdown rendering ───

  test('renders bold text', () => {
    const result = marked.parse('**bold**');
    expect(result).toContain('<strong>bold</strong>');
  });

  test('renders italic text', () => {
    const result = marked.parse('*italic*');
    expect(result).toContain('<em>italic</em>');
  });

  test('renders unordered lists', () => {
    const result = marked.parse('- item one\n- item two');
    expect(result).toContain('<li>item one</li>');
    expect(result).toContain('<li>item two</li>');
  });

  test('renders headings', () => {
    const result = marked.parse('## Heading');
    expect(result).toContain('<h2');
    expect(result).toContain('Heading');
  });

  test('renders inline code', () => {
    const result = marked.parse('use `query_orders`');
    expect(result).toContain('<code>query_orders</code>');
  });

  test('renders tables', () => {
    const input = '| Name | Value |\n| --- | --- |\n| Alice | 100 |';
    const result = marked.parse(input);
    expect(result).toContain('<table>');
    expect(result).toContain('Alice');
    expect(result).toContain('100');
  });

  test('renders plain text in paragraphs', () => {
    const result = marked.parse('Hello world');
    expect(result).toContain('<p>Hello world</p>');
  });

  // ─── HTML escaping (XSS prevention) ───

  test('escapes raw HTML script tags', () => {
    const result = marked.parse('<script>alert("xss")</script>');
    expect(result).not.toContain('<script>');
    expect(result).toContain('&lt;script&gt;');
  });

  test('escapes raw HTML img tags with onerror', () => {
    const result = marked.parse('<img src=x onerror=alert(1)>');
    expect(result).not.toContain('<img');
    expect(result).toContain('&lt;img');
  });

  test('escapes raw HTML anchor tags', () => {
    const result = marked.parse('<a href="javascript:alert(1)">click</a>');
    expect(result).not.toContain('<a href');
    expect(result).toContain('&lt;a href');
  });

  test('escapes raw div tags', () => {
    const result = marked.parse('<div style="color:red">danger</div>');
    expect(result).not.toContain('<div');
    expect(result).toContain('&lt;div');
  });

  test('does not escape markdown-generated HTML', () => {
    // Markdown bold generates <strong> — this should NOT be escaped
    const result = marked.parse('**safe bold**');
    expect(result).toContain('<strong>safe bold</strong>');
    expect(result).not.toContain('&lt;strong&gt;');
  });

  test('handles mixed markdown and raw HTML', () => {
    const result = marked.parse(
      '**bold text** and <script>alert(1)</script>',
    );
    expect(result).toContain('<strong>bold text</strong>');
    expect(result).toContain('&lt;script&gt;');
  });

  // ─── Edge cases ───

  test('handles empty string', () => {
    const result = marked.parse('');
    expect(result).toBe('');
  });

  test('handles null-like content gracefully', () => {
    const result = marked.parse('');
    expect(typeof result).toBe('string');
  });

  test('renders currency formatting in text', () => {
    const result = marked.parse('Total: $1,234.56');
    expect(result).toContain('$1,234.56');
  });
});
