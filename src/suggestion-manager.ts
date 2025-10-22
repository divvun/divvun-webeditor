/**
 * SuggestionManager - Handles tooltip and context menu creation, suggestion application, and popup positioning
 *
 * This class encapsulates all the logic for showing error suggestions to users
 * through tooltips, context menus, and handling suggestion applications.
 */

import type { CheckerError } from "./types.ts";
import { atomicTextReplace } from "./editor-utils.ts";

// Minimal editor interface for suggestion operations
interface EditorInterface {
  deleteText(index: number, length: number): void;
  insertText(index: number, text: string): void;
  formatText(
    index: number,
    length: number,
    format: string,
    value: boolean,
  ): void;
  setSelection(index: number, length: number): void;
  focus(): void;
  getText(): string;
}

export interface SuggestionCallbacks {
  onSuggestionApplied: (error: CheckerError, suggestion: string) => void;
  onClearErrors: () => void;
  onCheckText: () => void;
  onRecheckLine: (lineNumber: number) => void;
}

export class SuggestionManager {
  private editor: EditorInterface;
  private callbacks: SuggestionCallbacks;

  constructor(editor: EditorInterface, callbacks: SuggestionCallbacks) {
    this.editor = editor;
    this.callbacks = callbacks;
  }

  /**
   * Adjust coordinates to keep element within viewport bounds
   * @param x Desired x coordinate
   * @param y Desired y coordinate
   * @param elementWidth Expected width of element
   * @param elementHeight Expected height of element
   * @returns Adjusted coordinates
   */
  private constrainToViewport(
    x: number,
    y: number,
    elementWidth: number,
    elementHeight: number,
  ): { x: number; y: number } {
    const viewportWidth = globalThis.innerWidth ||
      document.documentElement.clientWidth;
    const viewportHeight = globalThis.innerHeight ||
      document.documentElement.clientHeight;

    const adjustedX = Math.max(10, Math.min(x, viewportWidth - elementWidth));
    const adjustedY = Math.max(
      10,
      Math.min(y, viewportHeight - elementHeight),
    );

    return { x: adjustedX, y: adjustedY };
  }

  /**
   * Show a tooltip with error suggestions near the mouse position
   */
  showSuggestionTooltip(
    _anchor: HTMLElement,
    error: CheckerError,
    index: number,
    length: number,
    ev: MouseEvent,
  ): void {
    // Remove existing tooltip
    const existing = document.querySelector(".error-tooltip");
    if (existing) existing.remove();

    const tooltip = document.createElement("div");
    tooltip.className = "error-tooltip";

    const title = document.createElement("div");
    title.className = "error-title";
    title.textContent = error.title || "Suggestion";
    tooltip.appendChild(title);

    if (error.description) {
      const desc = document.createElement("div");
      desc.className = "error-description";
      desc.textContent = error.description;
      tooltip.appendChild(desc);
    }

    const ul = document.createElement("ul");
    ul.className = "suggestions";

    if (error.suggestions && error.suggestions.length > 0) {
      // Show available suggestions
      error.suggestions.forEach((sugg) => {
        const li = document.createElement("li");
        li.textContent = sugg;
        li.addEventListener("click", (e) => {
          e.stopPropagation();
          this.applySuggestionToEditor(error, sugg, index, length);
          tooltip.remove();
        });
        ul.appendChild(li);
      });
    } else {
      // Show no suggestions available message
      const li = document.createElement("li");
      li.className = "no-suggestions";
      li.textContent = "No suggestions available for this error";
      li.style.fontStyle = "italic";
      li.style.color = "#666";
      li.style.cursor = "default";
      ul.appendChild(li);
    }

    tooltip.appendChild(ul);
    document.body.appendChild(tooltip);

    // Position near mouse but ensure within viewport
    const pos = this.constrainToViewport(
      ev.clientX + 8,
      ev.clientY + 8,
      320,
      200,
    );
    tooltip.style.left = `${pos.x}px`;
    tooltip.style.top = `${pos.y}px`;
  }

  /**
   * Show a context menu with error suggestions at the specified coordinates
   */
  showContextMenu(x: number, y: number, error: CheckerError): void {
    // Remove existing context menu
    const existing = document.getElementById("grammar-context-menu");
    if (existing) existing.remove();

    const menu = document.createElement("div");
    menu.id = "grammar-context-menu";

    // Use Tailwind classes for menu styling
    menu.className =
      "absolute bg-white border border-gray-300 rounded-md shadow-lg z-[1000] min-w-[120px] overflow-hidden";

    // Position the menu within viewport bounds
    const pos = this.constrainToViewport(x, y, 200, 150);
    menu.style.left = `${pos.x}px`;
    menu.style.top = `${pos.y}px`;

    // Add title if available
    if (error.title) {
      const title = document.createElement("div");
      title.className =
        "px-3 py-2 font-semibold border-b border-gray-200 text-xs text-gray-700 bg-gray-50";
      title.textContent = error.title;
      menu.appendChild(title);
    }

    // Add suggestions
    if (error.suggestions && error.suggestions.length > 0) {
      // Show available suggestions
      error.suggestions.forEach((suggestion) => {
        const btn = document.createElement("button");

        // Use Tailwind classes for button styling
        btn.className =
          "block w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 focus:bg-gray-100 focus:outline-none transition-colors duration-150";
        btn.textContent = suggestion;

        btn.addEventListener("click", () => {
          this.callbacks.onSuggestionApplied(error, suggestion);
          menu.remove();
        });

        menu.appendChild(btn);
      });
    } else {
      // Show no suggestions available message
      const noSuggestionsDiv = document.createElement("div");
      noSuggestionsDiv.className =
        "px-3 py-2 text-sm text-gray-500 italic text-center border-b border-gray-200";
      noSuggestionsDiv.textContent = "No suggestions available for this error";
      menu.appendChild(noSuggestionsDiv);

      // Add error text for reference in a non-clickable way
      const errorTextDiv = document.createElement("div");
      errorTextDiv.className =
        "px-3 py-2 text-xs text-gray-600 bg-gray-50 font-mono break-words";
      errorTextDiv.textContent = `Error: "${error.error_text}"`;
      menu.appendChild(errorTextDiv);
    }

    document.body.appendChild(menu);

    // Close menu when clicking outside - use longer delay to prevent immediate closure
    setTimeout(() => {
      const closeHandler = (e: Event) => {
        if (!menu.contains(e.target as Node)) {
          menu.remove();
          document.removeEventListener("click", closeHandler);
          document.removeEventListener("contextmenu", closeHandler);
        }
      };

      // Handle both click and contextmenu events for closing
      document.addEventListener("click", closeHandler);
      document.addEventListener("contextmenu", closeHandler);

      // Also close on escape key
      const escHandler = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          menu.remove();
          document.removeEventListener("keydown", escHandler);
          document.removeEventListener("click", closeHandler);
          document.removeEventListener("contextmenu", closeHandler);
        }
      };
      document.addEventListener("keydown", escHandler);
    }, 150); // Longer delay to prevent immediate closure from contextmenu event
  }

  /**
   * Apply a suggestion directly to the editor (used by tooltip)
   */
  private applySuggestionToEditor(
    _error: CheckerError,
    suggestion: string,
    index: number,
    length: number,
  ): void {
    try {
      // Use atomic text replacement to prevent intermediate state issues
      atomicTextReplace(this.editor, index, length, suggestion);

      // After replacement, clear formatting for that range
      this.editor.formatText(index, suggestion.length, "grammar-typo", false);
      this.editor.formatText(index, suggestion.length, "grammar-other", false);

      // Calculate line number from index
      const text = this.editor.getText();
      const lineNumber = text.substring(0, index).split("\n").length - 1;

      // Re-check only the affected line
      this.callbacks.onRecheckLine(lineNumber);
    } catch (_err) {
      // ignore
    }
  }

  /**
   * Remove any existing suggestion UI elements
   */
  clearSuggestionUI(): void {
    // Remove tooltip
    const tooltip = document.querySelector(".error-tooltip");
    if (tooltip) tooltip.remove();

    // Remove context menu
    const contextMenu = document.getElementById("grammar-context-menu");
    if (contextMenu) contextMenu.remove();
  }
}
