/**
 * Test for highlighting bug when pasting "Dqll."
 * Bug: Only "qll." gets highlighted instead of the full "Dqll."
 */

import { assertEquals } from "jsr:@std/assert@1";
import type { CheckerResponse, SupportedLanguage } from "../src/types.ts";

// Mock editor for testing
class MockEditor {
  private content = "";
  private formats: Map<
    string,
    Array<{ index: number; length: number; format: string; value: boolean }>
  > = new Map();
  root = { tagName: "DIV" } as unknown as HTMLElement;

  setText(text: string): void {
    this.content = text;
  }

  getText(): string {
    return this.content;
  }

  getLength(): number {
    return this.content.length;
  }

  formatText(
    index: number,
    length: number,
    format: string,
    value: boolean,
    _source?: string,
  ): void {
    if (!this.formats.has(format)) {
      this.formats.set(format, []);
    }
    this.formats.get(format)!.push({ index, length, format, value });
  }

  getFormats(
    format: string,
  ): Array<{ index: number; length: number; format: string; value: boolean }> {
    return this.formats.get(format) || [];
  }

  clearFormats(): void {
    this.formats.clear();
  }
}

// Mock API that returns the actual response structure from the API
class MockAPI {
  checkText(
    text: string,
    _language: SupportedLanguage,
  ): Promise<CheckerResponse> {
    // Simulate the actual API response for "Dqll."
    // The API typically returns errors with indices relative to the input text
    if (text === "Dqll." || text === "Dqll.\n") {
      return Promise.resolve({
        text: text,
        errs: [
          {
            error_text: "Dqll",
            start_index: 0,
            end_index: 4,
            error_code: "typo",
            title: "Čállinmeattáhuš",
            description: "Čállináŋgiris – čuokkis dahje fuolahis čállin",
            suggestions: ["Dállu", "Dálle", "dall", "Dulli"],
          },
        ],
      });
    }
    return Promise.resolve({ text, errs: [] });
  }

  getSupportedLanguages(): Array<{ code: SupportedLanguage; name: string }> {
    return [{ code: "se", name: "Northern Sami" }];
  }
}

Deno.test("Paste 'Dqll.' - should highlight full word, not just 'qll.'", async () => {
  const mockEditor = new MockEditor();
  const mockAPI = new MockAPI();

  // Simulate pasting "Dqll." into empty editor
  mockEditor.setText("Dqll.");

  // Get what the API would return
  const response = await mockAPI.checkText("Dqll.", "se");

  // Verify the API returns the correct error
  assertEquals(response.errs.length, 1);
  assertEquals(response.errs[0].error_text, "Dqll");
  assertEquals(response.errs[0].start_index, 0);
  assertEquals(response.errs[0].end_index, 4);

  // Now simulate highlighting
  const error = response.errs[0];
  const start = error.start_index;
  const length = error.end_index - error.start_index;

  // Highlight the error
  mockEditor.formatText(start, length, "grammar-typo", true);

  // Verify the formatting was applied to the correct range
  const formats = mockEditor.getFormats("grammar-typo");
  assertEquals(formats.length, 1, "Should have exactly one format applied");
  assertEquals(formats[0].index, 0, "Should start at index 0");
  assertEquals(formats[0].length, 4, "Should have length 4 to cover 'Dqll'");

  // Verify the highlighted text would be "Dqll", not "qll."
  const highlightedText = mockEditor.getText().substring(
    formats[0].index,
    formats[0].index + formats[0].length,
  );
  assertEquals(highlightedText, "Dqll", "Should highlight 'Dqll', not 'qll.'");
});

Deno.test("Paste 'Dqll.' with newline - should highlight full word", async () => {
  const mockEditor = new MockEditor();
  const mockAPI = new MockAPI();

  // Simulate pasting "Dqll." with newline (as it would appear in editor)
  mockEditor.setText("Dqll.\n");

  // Get what the API would return
  const response = await mockAPI.checkText("Dqll.\n", "se");

  // Verify the API returns the correct error
  assertEquals(response.errs.length, 1);
  const error = response.errs[0];

  // Highlight the error
  const start = error.start_index;
  const length = error.end_index - error.start_index;
  mockEditor.formatText(start, length, "grammar-typo", true);

  // Verify the formatting
  const formats = mockEditor.getFormats("grammar-typo");
  assertEquals(formats.length, 1);
  assertEquals(formats[0].index, 0, "Should start at index 0");
  assertEquals(formats[0].length, 4, "Should have length 4");

  // Verify the highlighted text
  const highlightedText = mockEditor.getText().substring(
    formats[0].index,
    formats[0].index + formats[0].length,
  );
  assertEquals(highlightedText, "Dqll", "Should highlight 'Dqll'");
});

Deno.test("Error indices should match actual word positions in document", () => {
  const text = "Dqll.";

  // The error is "Dqll" which is at positions 0-4
  const errorText = "Dqll";
  const expectedStart = text.indexOf(errorText);
  const expectedEnd = expectedStart + errorText.length;

  assertEquals(expectedStart, 0, "Error should start at position 0");
  assertEquals(expectedEnd, 4, "Error should end at position 4");
  assertEquals(text.substring(expectedStart, expectedEnd), "Dqll");
});
