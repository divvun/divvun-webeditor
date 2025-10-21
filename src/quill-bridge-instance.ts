// Quill types are not shipped with Deno by default; use any to avoid type issues in this small app
// Minimal Quill typings we need (Quill is loaded via CDN in the page)
// Use the runtime bridge created in src/quill-bridge.js (exposes `globalThis.QuillBridge`)
export interface QuillBridgeInstance {
  root: HTMLElement;
  getText(): string;
  on(event: string, handler: (...args: unknown[]) => void): void;
  getLength(): number;
  formatText(
    index: number,
    len: number,
    format: string,
    value: unknown,
    source?: string,
  ): void;
  setText(text: string): void;
  deleteText(index: number, len: number): void;
  insertText(index: number, text: string): void;
  focus(): void;
  findBlot?(node: Node): unknown;
  getIndex?(blot: unknown): number;
  getSelection(): { index: number; length: number } | null;
  setSelection(index: number, length?: number, source?: string): void;
  _quill?: {
    formatText: (
      index: number,
      length: number,
      format: string,
      value: unknown,
      source?: string,
    ) => void;
    setSelection: (index: number, length: number, source?: string) => void;
  };
}
// Register custom Quill blots for error highlighting
export function registerQuillBlots() {
  // Use runtime JavaScript to avoid TypeScript complexity with Quill blots
  const script = `
    if (typeof Quill !== 'undefined') {
      const Inline = Quill.import('blots/inline');
      
      class GrammarTypoBlot extends Inline {
        static create(value) {
          let node = super.create();
          node.classList.add('grammar-typo');
          return node;
        }
        static formats(node) {
          return 'grammar-typo';
        }
      }
      GrammarTypoBlot.blotName = 'grammar-typo';
      GrammarTypoBlot.tagName = 'span';

      class GrammarOtherBlot extends Inline {
        static create(value) {
          let node = super.create();
          node.classList.add('grammar-other');
          return node;
        }
        static formats(node) {
          return 'grammar-other';
        }
      }
      GrammarOtherBlot.blotName = 'grammar-other';
      GrammarOtherBlot.tagName = 'span';

      Quill.register(GrammarTypoBlot);
      Quill.register(GrammarOtherBlot);
    }
  `;

  // Execute the script
  const scriptElement = document.createElement("script");
  scriptElement.textContent = script;
  document.head.appendChild(scriptElement);
}
const maybeBridge = (
  globalThis as unknown as {
    QuillBridge?: {
      create: (
        container: string | HTMLElement,
        options?: unknown,
      ) => QuillBridgeInstance;
    };
  }
).QuillBridge;
if (!maybeBridge) {
  throw new Error(
    "QuillBridge is not available. Ensure src/quill-bridge.js is loaded.",
  );
}
export const QuillBridge = maybeBridge;
