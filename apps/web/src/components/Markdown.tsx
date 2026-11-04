import { Check, Copy } from 'lucide-react';
import { memo, useRef, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import remarkGfm from 'remark-gfm';

function CodeBlock({ children }: { children?: ReactNode }) {
  const ref = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(ref.current?.innerText ?? '');
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="group relative mb-3 overflow-hidden rounded-lg border border-line bg-bg">
      <button
        type="button"
        onClick={() => void copy()}
        aria-label="Copiar código"
        title="Copiar código"
        className="absolute top-1.5 right-1.5 z-10 inline-flex h-7 items-center gap-1 rounded-md border border-line bg-raised px-2 text-[11px] text-soft opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
      >
        {copied ? <Check size={12} /> : <Copy size={12} />}
        {copied ? 'Copiado' : 'Copiar'}
      </button>
      <pre ref={ref} className="overflow-x-auto p-3">{children}</pre>
    </div>
  );
}

// A saída dos agentes não é confiável: HTML cru não é renderizado, e links perigosos
// (como javascript:) são removidos pela própria biblioteca.
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="prose-chat">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: false, ignoreMissing: true }]]}
        components={{
          pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer noopener">
              {children}
            </a>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});
