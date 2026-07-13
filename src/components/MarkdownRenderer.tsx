import { useEffect, useMemo, useRef } from 'react';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { useMonaco } from '@monaco-editor/react';
import { THEME_SPECS } from '@abstractframework/ui-kit';

/**
 * Pick the Monaco colorize theme from the applied app theme class
 * (theme-<id> on the document root). Light themes previously got dark-palette
 * tokens over a light code-block surface — pale yellows on near-white.
 */
function monacoThemeForAppTheme(): 'vs' | 'vs-dark' {
  try {
    const classes = Array.from(document.documentElement.classList);
    const themeClass = classes.find((entry) => entry.startsWith('theme-'));
    const themeId = themeClass ? themeClass.slice('theme-'.length) : 'dark';
    const spec = THEME_SPECS.find((entry) => entry.id === themeId);
    return spec?.group === 'light' ? 'vs' : 'vs-dark';
  } catch {
    return 'vs-dark';
  }
}

export interface MarkdownRendererProps {
  markdown: string;
  className?: string;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function safeLang(raw: string): string {
  const value = (raw || '').trim().toLowerCase();
  if (!value) return 'plaintext';
  // Keep it conservative; this string becomes part of class names / attributes.
  if (!/^[a-z0-9_+-]+$/.test(value)) return 'plaintext';
  return value;
}

export function MarkdownRenderer({ markdown, className }: MarkdownRendererProps) {
  const monaco = useMonaco();
  const rootRef = useRef<HTMLDivElement | null>(null);
  // Keep the original (pre-highlight) code text so copy works even after Monaco replaces
  // newlines with <br> and indentation with &nbsp;.
  const rawCodeByElRef = useRef<WeakMap<HTMLElement, string>>(new WeakMap());

  const sanitizedHtml = useMemo(() => {
    const md = typeof markdown === 'string' ? markdown : String(markdown ?? '');

    const renderer = new marked.Renderer();
    // marked@14 passes a token object to renderer.code:
    // ({ text, lang, escaped }: Code) => string
    renderer.code = ({ text, lang }: { text: string; lang?: string }) => {
      const language = safeLang((lang || '').split(/\s+/)[0] || '');
      const safeCode = escapeHtml(text || '');
      return (
        `<div class="md-code-block" data-lang="${language}">` +
        `<div class="md-code-toolbar">` +
        `<span class="md-code-lang">${language}</span>` +
        `<button type="button" class="md-code-copy" data-md-copy="true">Copy</button>` +
        `</div>` +
        `<pre><code data-lang="${language}" class="language-${language}">${safeCode}</code></pre>` +
        `</div>`
      );
    };

    const raw = marked.parse(md, { gfm: true, breaks: true, renderer }) as string;

    // Sanitize aggressively; allow our `data-*` attrs for code blocks.
    const sanitized = DOMPurify.sanitize(raw, {
      USE_PROFILES: { html: true },
      ADD_TAGS: ['button'],
      ADD_ATTR: ['data-lang', 'data-md-copy'],
    });

    // Links open in a new tab (backlog 0116): same-tab navigation ejects the
    // user from the SPA and destroys run-modal state. Applied post-sanitize on
    // a detached tree so target/rel survive DOMPurify's attribute policy.
    // Fragment-only links (#anchor) stay same-document.
    const container = document.createElement('div');
    container.innerHTML = sanitized;
    for (const anchor of Array.from(container.querySelectorAll('a[href]'))) {
      const href = anchor.getAttribute('href') || '';
      if (href.startsWith('#')) continue;
      anchor.setAttribute('target', '_blank');
      anchor.setAttribute('rel', 'noopener noreferrer');
    }
    return container.innerHTML;
  }, [markdown]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    if (!monaco) return;

    // Match syntax highlighting to the applied app theme: light themes get
    // 'vs', dark themes 'vs-dark'. (Monaco's theme is global; the code editor
    // modal sets its own theme when it opens.)
    try {
      monaco.editor.setTheme(monacoThemeForAppTheme());
    } catch {
      // Ignore: theme setting is best-effort.
    }

    let cancelled = false;
    const nodes = Array.from(root.querySelectorAll('pre code[data-lang]')) as HTMLElement[];

    (async () => {
      for (const node of nodes) {
        if (cancelled) return;
        const lang = safeLang(node.dataset.lang || '');
        const text = node.textContent || '';
        if (!text.trim()) continue;

        // Store the raw text for reliable copy-to-clipboard (preserve newlines/indentation).
        rawCodeByElRef.current.set(node, text);

        try {
          const html = await monaco.editor.colorize(text, lang, { tabSize: 2 });
          if (cancelled) return;
          node.innerHTML = html;
        } catch {
          // If colorization fails, keep the plain text.
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [monaco, sanitizedHtml]);

  const onClick = async (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement | null;
    const btn = target?.closest?.('[data-md-copy]') as HTMLElement | null;
    if (!btn) return;

    const block = btn.closest('.md-code-block');
    const codeEl = block?.querySelector('pre code') as HTMLElement | null;
    // Prefer the raw, pre-colorized code (Monaco HTML loses literal newlines on textContent).
    const text = (codeEl ? rawCodeByElRef.current.get(codeEl) : null) || codeEl?.textContent || '';
    if (!text) return;

    try {
      await navigator.clipboard.writeText(text);
      // Best-effort feedback (no dependency on toast)
      btn.textContent = 'Copied';
      window.setTimeout(() => {
        if (btn) btn.textContent = 'Copy';
      }, 900);
    } catch {
      // Ignore
    }
  };

  return (
    <div
      ref={rootRef}
      className={className ? `markdown-body ${className}` : 'markdown-body'}
      onClick={onClick}
      // Sanitized above via DOMPurify
      dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
    />
  );
}

export default MarkdownRenderer;


