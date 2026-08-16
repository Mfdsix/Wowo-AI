import ReactMarkdown, { type Components } from "react-markdown";

// Renderer markdown ringan, konsisten dengan ChatArea (tanpa <pre> wrap,
// tapi tanpa CodeBlock berat — cukup inline code). Dipakai di Curiosity Engine.
const MD: Components = {
  pre({ children }) {
    return <>{children}</>;
  },
  code({ className, children }) {
    const match = /language-(\w+)/.exec(className || "");
    const code = String(children).replace(/\n$/, "");
    if (!match) {
      return (
        <code className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-200 text-[0.85em] font-mono">
          {children}
        </code>
      );
    }
    return (
      <pre className="my-2 p-3 rounded-lg bg-zinc-950 overflow-x-auto text-[0.8em] font-mono text-zinc-300">
        <code>{code}</code>
      </pre>
    );
  },
};

export default function MarkdownLite({ children }: { children: string }) {
  return (
    <div className="prose prose-invert prose-sm max-w-none break-words text-zinc-300 [&_a]:text-amber-400 [&_a]:underline">
      <ReactMarkdown components={MD}>{children}</ReactMarkdown>
    </div>
  );
}
