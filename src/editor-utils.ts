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
 * @throws Error if the replacement operation fails
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
    try {
      // Create a delta that retains up to start, deletes length, inserts replacement
      // Filter out any operations with zero length to avoid Quill errors
      const ops: Array<Record<string, unknown>> = [];

      if (start > 0) {
        ops.push({ retain: start });
      }
      if (length > 0) {
        ops.push({ delete: length });
      }
      if (replacement.length > 0) {
        ops.push({ insert: replacement });
      }

      // Only proceed if we have operations to perform
      if (ops.length > 0) {
        const replaceDelta = { ops };
        quill.updateContents(replaceDelta, "api");
      }
    } catch (error) {
      console.error(
        "Quill updateContents failed, falling back to separate operations:",
        error
      );
      // Fallback on error
      if (length > 0) {
        editor.deleteText(start, length);
      }
      if (replacement.length > 0) {
        editor.insertText(start, replacement);
      }
    }
  } else {
    // Fallback: Use delete + insert in immediate sequence
    // This may cause intermediate state issues but maintains backward compatibility
    if (length > 0) {
      editor.deleteText(start, length);
    }
    if (replacement.length > 0) {
      editor.insertText(start, replacement);
    }
  }
}
