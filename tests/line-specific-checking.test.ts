/**
 * Tests for line-specific grammar checking functionality
 */

import { assertEquals, assert } from "jsr:@std/assert@1";
import { TextAnalyzer } from "../src/text-analyzer.ts";
import {
  CheckerError,
  CheckerApi,
  CheckerResponse,
  SupportedLanguage,
} from "../src/types.ts";

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
    language: SupportedLanguage
  ): Promise<CheckerResponse> {
    this.callLog.push({ text, language });

    const errors = this.mockResponses.get(text) || [];

    // Simulate network delay
    await new Promise((resolve) => setTimeout(resolve, 10));

    return { text, errs: errors };
  }

  getSupportedLanguages(): Array<{ code: SupportedLanguage; name: string }> {
    return [{ code: "se", name: "Northern Sami" }]; // Mock implementation
  }

  clearCallLog(): void {
    this.callLog = [];
  }
}

// Mock callbacks
function createMockCallbacks() {
  const calls: { method: string; args: unknown[] }[] = [];

  return {
    callbacks: {
      onUpdateStatus: (status: string, isChecking: boolean) =>
        calls.push({ method: "onUpdateStatus", args: [status, isChecking] }),
      onUpdateErrorCount: (count: number) =>
        calls.push({ method: "onUpdateErrorCount", args: [count] }),
      onErrorsFound: (errors: CheckerError[], lineNumber?: number) =>
        calls.push({ method: "onErrorsFound", args: [errors, lineNumber] }),
      onShowErrorMessage: (message: string) =>
        calls.push({ method: "onShowErrorMessage", args: [message] }),
    },
    calls,
  };
}

// Helper function to create a checker error
function createError(
  text: string,
  startIndex: number,
  endIndex: number
): CheckerError {
  return {
    error_text: text,
    start_index: startIndex,
    end_index: endIndex,
    error_code: "typo",
    title: "Spelling error",
    description: `"${text}" is misspelled`,
    suggestions: [`corrected_${text}`, `fixed_${text}`],
  };
}

Deno.test("Line-specific checking - Single line API call", async () => {
  const mockEditor = new MockEditor();
  const mockAPI = new MockAPI();
  const { callbacks } = createMockCallbacks();

  const analyzer = new TextAnalyzer(mockAPI, mockEditor, callbacks, "se");

  // Set up text with multiple lines
  mockEditor.setText(
    "First line with error\nSecond line is correct\nThird line"
  );

  // Mock response for just the first line
  mockAPI.setMockResponse("First line with error", [
    createError("error", 16, 21), // positions within the line
  ]);

  // Check specific line
  const errors = await analyzer.checkSpecificLine(0);

  // Verify API was called with only the first line
  assertEquals(mockAPI.callLog.length, 1);
  assertEquals(mockAPI.callLog[0].text, "First line with error");

  // Verify errors are returned with absolute positions
  assertEquals(errors.length, 1);
  assertEquals(errors[0].error_text, "error");
  assertEquals(errors[0].start_index, 16); // Should be converted to absolute position
});

Deno.test(
  "Line-specific checking - Multi-line position calculation",
  async () => {
    const mockEditor = new MockEditor();
    const mockAPI = new MockAPI();
    const { callbacks } = createMockCallbacks();

    const analyzer = new TextAnalyzer(mockAPI, mockEditor, callbacks, "se");

    // Set up multi-line text
    const lines = [
      "Line 0 has errors here", // 22 chars + \n = 23
      "Line 1 is clean", // 15 chars + \n = 16
      "Line 2 has problems too", // 23 chars
    ];
    mockEditor.setText(lines.join("\n"));

    // Mock response for line 2 (third line)
    mockAPI.setMockResponse("Line 2 has problems too", [
      createError("problems", 11, 19), // Line-relative position
    ]);

    const errors = await analyzer.checkSpecificLine(2);

    // Calculate expected absolute position:
    // Line 0: 23 chars, Line 1: 16 chars, Line 2 starts at: 23 + 16 = 39
    // Error at line position 11 = absolute position 39 + 11 = 50
    assertEquals(errors.length, 1);
    assertEquals(errors[0].start_index, 39 + 11); // 50
    assertEquals(errors[0].end_index, 39 + 19); // 58
  }
);

Deno.test("Line-specific checking - Empty and invalid lines", async () => {
  const mockEditor = new MockEditor();
  const mockAPI = new MockAPI();
  const { callbacks } = createMockCallbacks();

  const analyzer = new TextAnalyzer(mockAPI, mockEditor, callbacks, "se");

  mockEditor.setText("Line 0\n\nLine 2");

  // Check empty line
  const emptyLineErrors = await analyzer.checkSpecificLine(1);
  assertEquals(emptyLineErrors.length, 0);
  assertEquals(mockAPI.callLog.length, 0); // No API call for empty line

  // Check invalid line number
  const invalidLineErrors = await analyzer.checkSpecificLine(999);
  assertEquals(invalidLineErrors.length, 0);
});

Deno.test("Line-specific checking - Caching behavior", async () => {
  const mockEditor = new MockEditor();
  const mockAPI = new MockAPI();
  const { callbacks } = createMockCallbacks();

  const analyzer = new TextAnalyzer(mockAPI, mockEditor, callbacks, "se");

  mockEditor.setText("Same line content\nOther line");

  mockAPI.setMockResponse("Same line content", [createError("line", 5, 9)]);

  // First check - should call API
  await analyzer.checkSpecificLine(0);
  assertEquals(mockAPI.callLog.length, 1);

  mockAPI.clearCallLog();

  // Second check within cache window - should not call API
  await analyzer.checkSpecificLine(0);
  assertEquals(mockAPI.callLog.length, 0);

  // Check cache statistics
  const stats = analyzer.getCacheStats();
  assertEquals(stats.size, 1);
  assertEquals(stats.entries[0].lineNumber, 0);
});

Deno.test(
  "Line-specific checking - Error preservation across edits",
  async () => {
    const mockEditor = new MockEditor();
    const mockAPI = new MockAPI();
    const { callbacks, calls } = createMockCallbacks();

    const analyzer = new TextAnalyzer(mockAPI, mockEditor, callbacks, "se");

    // Initial multi-line text
    mockEditor.setText("Line 0 has error\nLine 1 is good\nLine 2 also good");

    mockAPI.setMockResponse("Line 0 has error", [createError("error", 11, 16)]);

    // Check line 0 - should find error
    const line0Errors = await analyzer.checkSpecificLine(0);
    assertEquals(line0Errors.length, 1);

    // Now edit line 1 only
    mockEditor.setText(
      "Line 0 has error\nLine 1 is modified\nLine 2 also good"
    );

    mockAPI.clearCallLog();
    mockAPI.setMockResponse("Line 1 is modified", []); // No errors in modified line

    // Check line 1 - should not affect line 0 cache
    await analyzer.checkSpecificLine(1);

    // Line 0 should still have cached error
    const line0ErrorsAfterEdit = await analyzer.checkSpecificLine(0);
    assertEquals(line0ErrorsAfterEdit.length, 1);
    assertEquals(mockAPI.callLog.length, 1); // Only called for line 1
  }
);

Deno.test("Line-specific checking - Callback integration", async () => {
  const mockEditor = new MockEditor();
  const mockAPI = new MockAPI();
  const { callbacks, calls } = createMockCallbacks();

  const analyzer = new TextAnalyzer(mockAPI, mockEditor, callbacks, "se");

  mockEditor.setText("Line with errors");

  mockAPI.setMockResponse("Line with errors", [createError("errors", 10, 16)]);

  await analyzer.checkSpecificLine(0);

  // Check that appropriate callbacks were triggered
  const errorFoundCalls = calls.filter(
    (call) => call.method === "onErrorsFound"
  );
  assertEquals(errorFoundCalls.length, 1);

  const [errors, lineNumber] = errorFoundCalls[0].args;
  assertEquals((errors as CheckerError[]).length, 1);
  assertEquals(lineNumber, 0);
});

Deno.test("Line-specific checking - Performance comparison", async () => {
  const mockEditor = new MockEditor();
  const mockAPI = new MockAPI();
  const { callbacks } = createMockCallbacks();

  const analyzer = new TextAnalyzer(mockAPI, mockEditor, callbacks, "se");

  // Create large document
  const lines = Array.from({ length: 50 }, (_, i) => `Line ${i} content here`);
  mockEditor.setText(lines.join("\n"));

  // Set up mock response for line 25
  mockAPI.setMockResponse("Line 25 content here", [createError("25", 5, 7)]);

  const start = performance.now();
  const _errors = await analyzer.checkSpecificLine(25);
  const duration = performance.now() - start;

  // Should only have made one API call for the specific line
  assertEquals(mockAPI.callLog.length, 1);
  assertEquals(mockAPI.callLog[0].text, "Line 25 content here");

  // Performance should be reasonable (under 100ms for mock)
  assert(
    duration < 100,
    `Line-specific check took ${duration}ms, expected < 100ms`
  );
});
