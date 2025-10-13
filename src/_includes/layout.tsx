import type { LayoutProps } from "./layout-types.ts";

export const layout = "main.tsx";

export default function EditorLayout({
  title: _title,
  description: _description,
  children,
}: LayoutProps) {
  return (
    <>
      <div className="editor-wrapper space-y-6">{children}</div>

      {/* Editor-specific scripts */}
      <script src="https://cdn.quilljs.com/1.3.7/quill.min.js"></script>
      <script src="quill-bridge.js"></script>
      <script type="module" src="main.js"></script>
    </>
  );
}
