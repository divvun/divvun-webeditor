import type { LayoutProps } from "./layout-types.ts";

export const layout = "main.tsx";

export default function EditorLayout({
  title: _title,
  description: _description,
  children,
  git,
}: LayoutProps) {
  // Use git hash for cache-busting to ensure users get latest version
  // Fallback to timestamp if git info is not available
  const version = git?.shortHash || Date.now().toString();

  return (
    <>
      <div className="editor-wrapper space-y-6">{children}</div>

      {/* Editor-specific scripts */}
      <script src="https://cdn.quilljs.com/1.3.7/quill.min.js"></script>
      <script src={`quill-bridge.js?v=${version}`}></script>
      <script type="module" src={`main.js?v=${version}`}></script>
    </>
  );
}
