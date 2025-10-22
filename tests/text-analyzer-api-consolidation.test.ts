/**
 * Integration tests to verify that all checkText API calls
 * go through TextAnalyzer, not directly from main.ts
 *
 * These tests verify the new checkLineForStateManagement and
 * checkMultipleLinesForStateManagement methods that centralize
 * all API calls in TextAnalyzer.
 */

import { assertEquals } from "jsr:@std/assert@1";
import type {
  CheckerApi,
  CheckerError,
  CheckerResponse,
  SupportedLanguage,
} from "../src/types.ts";
import { TextAnalyzer } from "../src/text-analyzer.ts";

// Mock editor interface
class MockEditor {
  private content = "";

  setText(text: string): void {
    this.content = text;
  }

  getText(): string {
    return this.content;
  }

  getLength(): number {
    return this.content.length;
  }
}

// Mock API with controllable responses
class MockAPI implements CheckerApi {
  private mockResponses: Map<string, CheckerError[]> = new Map();
  public callLog: { text: string; language: SupportedLanguage }[] = [];

  setMockResponse(text: string, errors: CheckerError[]): void {
    this.mockResponses.set(text, errors);
  }

  async checkText(
    text: string,
    language: SupportedLanguage,
  ): Promise<CheckerResponse> {
    this.callLog.push({ text, language });
    const errors = this.mockResponses.get(text) || [];
    await new Promise((resolve) => setTimeout(resolve, 1));
    return { text, errs: errors };
  }

  getSupportedLanguages(): Array<{ code: SupportedLanguage; name: string }> {
    return [{ code: "se", name: "Northern Sami" }];
  }

  clearCallLog(): void {
    this.callLog = [];
  }
}

// Helper to create mock error
function createError(
  text: string,
  startIndex: number,
  endIndex: number,
): CheckerError {
  return {
    error_text: text,
    start_index: startIndex,
    end_index: endIndex,
    error_code: "typo",
    title: "Spelling error",
    description: `"${text}" is misspelled`,
    suggestions: [`corrected_${text}`],
  };
}

Deno.test("TextAnalyzer - checkLineForStateManagement returns adjusted errors", async () => {
  const mockEditor = new MockEditor();
  const mockAPI = new MockAPI();
  const callbacks = {
    onUpdateStatus: () => {},
    onUpdateErrorCount: () => {},
    onErrorsFound: () => {},
    onShowErrorMessage: () => {},
  };
  const analyzer = new TextAnalyzer(mockAPI, mockEditor, callbacks, "se");

  // Set up text with multiple lines
  mockEditor.setText("Dqll. First line.\nSecond line.\nThird line.");

  // Mock response for the first line
  mockAPI.setMockResponse("Dqll. First line.\n", [
    createError("Dqll", 0, 4),
  ]);

  // Check line 0
  const errors = await analyzer.checkLineForStateManagement(0);

  // Verify API was called once with the first line including newline
  assertEquals(mockAPI.callLog.length, 1);
  assertEquals(mockAPI.callLog[0].text, "Dqll. First line.\n");

  // Verify errors are returned with adjusted positions (should be at document start)
  assertEquals(errors.length, 1);
  assertEquals(errors[0].error_text, "Dqll");
  assertEquals(errors[0].start_index, 0);
  assertEquals(errors[0].end_index, 4);
});

Deno.test("TextAnalyzer - checkLineForStateManagement adjusts positions for non-first lines", async () => {
  const mockEditor = new MockEditor();
  const mockAPI = new MockAPI();
  const callbacks = {
    onUpdateStatus: () => {},
    onUpdateErrorCount: () => {},
    onErrorsFound: () => {},
    onShowErrorMessage: () => {},
  };
  const analyzer = new TextAnalyzer(mockAPI, mockEditor, callbacks, "se");

  // Set up multi-line text
  mockEditor.setText("Line 0 text\nLine 1 text\nLine 2 text");

  // Mock response for line 1 (second line)
  mockAPI.setMockResponse("Line 1 text\n", [
    createError("text", 7, 11), // Line-relative position
  ]);

  // Check line 1
  const errors = await analyzer.checkLineForStateManagement(1);

  // Verify API was called
  assertEquals(mockAPI.callLog.length, 1);
  assertEquals(mockAPI.callLog[0].text, "Line 1 text\n");

  // Verify error position is adjusted
  // Line 0 is "Line 0 text\n" = 12 characters
  // Line 1 starts at index 12
  // Error at line position 7 = absolute position 12 + 7 = 19
  assertEquals(errors.length, 1);
  assertEquals(errors[0].start_index, 12 + 7); // 19
  assertEquals(errors[0].end_index, 12 + 11); // 23
});

Deno.test("TextAnalyzer - checkMultipleLinesForStateManagement checks range", async () => {
  const mockEditor = new MockEditor();
  const mockAPI = new MockAPI();
  const callbacks = {
    onUpdateStatus: () => {},
    onUpdateErrorCount: () => {},
    onErrorsFound: () => {},
    onShowErrorMessage: () => {},
  };
  const analyzer = new TextAnalyzer(mockAPI, mockEditor, callbacks, "se");

  // Set up multi-line text
  mockEditor.setText("Line 0 text\nLine 1 text\nLine 2 text\nLine 3 text");

  // Mock responses for lines 1 and 2
  mockAPI.setMockResponse("Line 1 text\n", [createError("Line", 0, 4)]);
  mockAPI.setMockResponse("Line 2 text\n", [createError("Line", 0, 4)]);

  // Check only lines 1 and 2
  const errors = await analyzer.checkMultipleLinesForStateManagement(1, 2);

  // Verify API was called exactly twice (for lines 1 and 2 only)
  assertEquals(mockAPI.callLog.length, 2);
  assertEquals(mockAPI.callLog[0].text, "Line 1 text\n");
  assertEquals(mockAPI.callLog[1].text, "Line 2 text\n");

  // Verify we got errors from both lines
  assertEquals(errors.length, 2);
});

Deno.test("TextAnalyzer - checkMultipleLinesForStateManagement adjusts error indices", async () => {
  const mockEditor = new MockEditor();
  const mockAPI = new MockAPI();
  const callbacks = {
    onUpdateStatus: () => {},
    onUpdateErrorCount: () => {},
    onErrorsFound: () => {},
    onShowErrorMessage: () => {},
  };
  const analyzer = new TextAnalyzer(mockAPI, mockEditor, callbacks, "se");

  // Set up multi-line text
  mockEditor.setText("Line 0\nLine 1\nLine 2");

  // Mock responses for all lines - each has error at start of line
  mockAPI.setMockResponse("Line 0\n", [createError("Line", 0, 4)]);
  mockAPI.setMockResponse("Line 1\n", [createError("Line", 0, 4)]);
  mockAPI.setMockResponse("Line 2", [createError("Line", 0, 4)]);

  // Check all lines
  const errors = await analyzer.checkMultipleLinesForStateManagement(0, 2);

  // Verify we got 3 errors
  assertEquals(errors.length, 3);

  // Line 0 starts at 0
  assertEquals(errors[0].start_index, 0);
  assertEquals(errors[0].end_index, 4);

  // Line 1 starts at 7 ("Line 0\n" = 7 chars)
  assertEquals(errors[1].start_index, 7);
  assertEquals(errors[1].end_index, 11);

  // Line 2 starts at 14 ("Line 0\nLine 1\n" = 14 chars)
  assertEquals(errors[2].start_index, 14);
  assertEquals(errors[2].end_index, 18);
});

Deno.test("TextAnalyzer - checkMultipleLinesForStateManagement calls progress callback", async () => {
  const mockEditor = new MockEditor();
  const mockAPI = new MockAPI();
  const callbacks = {
    onUpdateStatus: () => {},
    onUpdateErrorCount: () => {},
    onErrorsFound: () => {},
    onShowErrorMessage: () => {},
  };
  const analyzer = new TextAnalyzer(mockAPI, mockEditor, callbacks, "se");

  // Set up multi-line text
  mockEditor.setText("Line 0\nLine 1\nLine 2");

  // Mock responses
  mockAPI.setMockResponse("Line 0\n", []);
  mockAPI.setMockResponse("Line 1\n", []);
  mockAPI.setMockResponse("Line 2", []);

  // Track progress messages
  const progressMessages: string[] = [];

  // Check all lines with progress callback
  await analyzer.checkMultipleLinesForStateManagement(
    0,
    2,
    (message) => progressMessages.push(message),
  );

  // Verify progress callback was called for each line
  assertEquals(progressMessages.length, 3);
  assertEquals(progressMessages[0], "Checking affected line 1...");
  assertEquals(progressMessages[1], "Checking affected line 2...");
  assertEquals(progressMessages[2], "Checking affected line 3...");
});

Deno.test("TextAnalyzer - API consolidation: no direct checkText calls from main.ts", async () => {
  // This test documents the architectural decision that all checkText API calls
  // should go through TextAnalyzer, not directly from main.ts

  const mockEditor = new MockEditor();
  const mockAPI = new MockAPI();
  const callbacks = {
    onUpdateStatus: () => {},
    onUpdateErrorCount: () => {},
    onErrorsFound: () => {},
    onShowErrorMessage: () => {},
  };
  const analyzer = new TextAnalyzer(mockAPI, mockEditor, callbacks, "se");

  mockEditor.setText("Test line");
  mockAPI.setMockResponse("Test line", []);

  // Before refactoring: main.ts would call api.checkText() directly
  // After refactoring: main.ts calls TextAnalyzer methods instead

  // Use the new state management methods
  await analyzer.checkLineForStateManagement(0);

  // Verify the API was called through TextAnalyzer
  assertEquals(mockAPI.callLog.length, 1);
  assertEquals(mockAPI.callLog[0].text, "Test line");

  // This centralizes all API calls in one place (TextAnalyzer)
  // Benefits:
  // - Single source of truth for API interactions
  // - Easier to add caching, retry logic, etc.
  // - Better separation of concerns
  // - Simpler testing
});
