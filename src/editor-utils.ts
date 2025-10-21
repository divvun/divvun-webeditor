/**
 * Minimal editor interface for atomic text replacement
 */
interface EditorWithQuill {
  deleteText(index: number, length: number): void;
  insertText(index: number, text: string): void;
  // deno-lint-ignore no-explicit-any
  _quill?: any; // Optional underlying Quill instance
}

/**
 * Atomically replace text in the editor using Quill's updateContents Delta API.
 * This prevents intermediate state issues that can cause Quill internal errors.
 *
 * @param editor - The Quill editor instance
 * @param start - Start index of text to replace
 * @param length - Length of text to replace
 * @param replacement - Text to insert in place of the deleted text
 */
export function atomicTextReplace(
  editor: EditorWithQuill,
  start: number,
  length: number,
  replacement: string
): void {
  // Access the underlying Quill instance for the updateContents method
  // deno-lint-ignore no-explicit-any
  const quill = (editor as any)._quill;

  if (quill && quill.updateContents) {
    // Create a delta that retains up to start, deletes length, inserts replacement
    const replaceDelta = {
      ops: [{ retain: start }, { delete: length }, { insert: replacement }],
    };
    quill.updateContents(replaceDelta, "api");
  } else {
    // Fallback: Use delete + insert in immediate sequence
    // This may cause intermediate state issues but maintains backward compatibility
    editor.deleteText(start, length);
    editor.insertText(start, replacement);
  }
}
