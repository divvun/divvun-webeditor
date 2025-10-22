/**
 * Integration test for paste highlighting position bug
 *
 * Bug: When pasting text with errors, the highlighting position is off by one character.
 * The error "dahkku" at position 24-30 is highlighted as " dahkk" at position 23-29.
 *
 * This test verifies that error highlighting uses the correct start and end indices.
 */

import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import type {
  CheckerApi,
  CheckerError,
  CheckerResponse,
  SupportedLanguage,
} from "../src/types.ts";
import { TextAnalyzer } from "../src/text-analyzer.ts";

/**
 * Mock CheckerApi for testing
 */
class MockCheckerApi implements CheckerApi {
  checkText(
    text: string,
    _language: SupportedLanguage,
  ): Promise<CheckerResponse> {
    // Mock response for the specific test text
    if (
      text ===
        " UNOHAS DAHKU: - Unohas dahkku go Magnhild Mathisena eai dohkkehan, lohket Magnhilda bellodatolbmot."
    ) {
      return Promise.resolve({
        text:
          "UNOHAS DAHKU: - Unohas dahkku go Magnhild Mathisena eai dohkkehan, lohket Magnhilda bellodatolbmo",
        errs: [
          {
            error_text: "dahkku",
            start_index: 23,
            end_index: 29,
            error_code: "real-ImprtDu1-NSgNom",
            description:
              "Sátni šaddá eará go oaivvilduvvo. Don leat čállán vearba duála imperatiivvas (⁨dahkku⁩). Galgá go substantiiva?",
            suggestions: ["dahku"],
            title: "Konsonántameattáhus",
          },
        ],
      });
    }
    // Default empty response
    return Promise.resolve({ text: text.trim(), errs: [] });
  }

  getSupportedLanguages() {
    return [{ code: "se" as SupportedLanguage, name: "Northern Sámi" }];
  }
}

/**
 * Mock editor interface
 */
class MockEditor {
  private text: string;

  constructor(text: string) {
    this.text = text;
  }

  getText(): string {
    return this.text;
  }

  getLength(): number {
    return this.text.length;
  }
}

Deno.test("Paste highlighting - error position should be exact", async () => {
  const text =
    " UNOHAS DAHKU: - Unohas dahkku go Magnhild Mathisena eai dohkkehan, lohket Magnhilda bellodatolbmot.";

  // Create mock API and editor
  const mockApi = new MockCheckerApi();
  const mockEditor = new MockEditor(text);

  // Create TextAnalyzer with callbacks
  let foundErrors: CheckerError[] = [];
  const callbacks = {
    onErrorsFound: (errors: CheckerError[]) => {
      foundErrors = errors;
    },
    onUpdateErrorCount: (_count: number) => {},
    onUpdateStatus: (_status: string, _isChecking: boolean) => {},
    onShowErrorMessage: (_message: string) => {},
  };

  const textAnalyzer = new TextAnalyzer(mockApi, mockEditor, callbacks, "se");

  // Check the line (line 0 since it's the first line)
  const errors = await textAnalyzer.checkLineForStateManagement(0);

  // The API returns error at 23-29 (relative to trimmed text "UNOHAS DAHKU: - Unohas dahkku...")
  // TextAnalyzer should adjust to 24-30 (accounting for leading space in original text)
  assertEquals(errors.length, 1, "Should find 1 error");
  assertEquals(errors[0].error_text, "dahkku", "Error text should be 'dahkku'");

  // Verify TextAnalyzer properly adjusted the indices
  assertEquals(
    errors[0].start_index,
    24,
    "Error should start at index 24 (adjusted)",
  );
  assertEquals(
    errors[0].end_index,
    30,
    "Error should end at index 30 (adjusted)",
  );

  // The error word "dahkku" appears at index 24 in the original text
  const errorWord = "dahkku";
  const errorStartIndex = text.indexOf(errorWord);
  const errorEndIndex = errorStartIndex + errorWord.length;

  console.log(
    `\n📍 Error word "${errorWord}" at indices ${errorStartIndex}-${errorEndIndex}`,
  );
  console.log(
    `   Text at position: "${text.substring(errorStartIndex, errorEndIndex)}"`,
  );
  console.log(
    `   API returned: ${errors[0].start_index}-${errors[0].end_index}`,
  );

  // Verify the adjusted indices match the actual word position
  assertEquals(
    errors[0].start_index,
    errorStartIndex,
    "Adjusted start should match actual position",
  );
  assertEquals(
    errors[0].end_index,
    errorEndIndex,
    "Adjusted end should match actual position",
  );

  // Verify the text at the error's indices is correct
  const highlightedText = text.substring(
    errors[0].start_index,
    errors[0].end_index,
  );
  assertEquals(
    highlightedText,
    "dahkku",
    "Highlighted text should be exactly 'dahkku', not ' dahkk'",
  );

  // Verify we're NOT highlighting the wrong range (the bug would be at 23-29)
  const bugStart = 23;
  const bugEnd = 29;
  const wrongHighlight = text.substring(bugStart, bugEnd);
  assertEquals(
    wrongHighlight,
    " dahkk",
    "This is what the bug would incorrectly highlight",
  );

  // Assert that our error does NOT match the buggy behavior
  assertEquals(
    errors[0].start_index !== bugStart,
    true,
    "Error indices should NOT match the buggy off-by-one positions",
  );

  console.log(
    `✅ Error positions are correct: ${errors[0].start_index}-${
      errors[0].end_index
    }`,
  );
});

Deno.test("Paste highlighting - leading space should not be included", () => {
  const text =
    " UNOHAS DAHKU: - Unohas dahkku go Magnhild Mathisena eai dohkkehan, lohket Magnhilda bellodatolbmot.";

  const errorStartIndex = 24;
  const errorEndIndex = 30;

  // Character before the error should be a space
  const charBefore = text.charAt(errorStartIndex - 1);
  assertEquals(charBefore, " ", "Character before error should be a space");

  // Error should NOT include the leading space
  const errorText = text.substring(errorStartIndex, errorEndIndex);
  assertEquals(
    errorText,
    "dahkku",
    "Error text should not include leading space",
  );
  assertEquals(
    errorText.startsWith(" "),
    false,
    "Error text should NOT start with a space",
  );

  console.log(`✅ Leading space is correctly excluded from error range`);
});

Deno.test("Paste highlighting - trailing character should not be included", () => {
  const text =
    " UNOHAS DAHKU: - Unohas dahkku go Magnhild Mathisena eai dohkkehan, lohket Magnhilda bellodatolbmot.";

  const errorStartIndex = 24;
  const errorEndIndex = 30;

  // Character after the error should be a space
  const charAfter = text.charAt(errorEndIndex);
  assertEquals(charAfter, " ", "Character after error should be a space");

  // Error should NOT include the trailing space
  const errorText = text.substring(errorStartIndex, errorEndIndex);
  assertEquals(
    errorText,
    "dahkku",
    "Error text should not include trailing space",
  );
  assertEquals(
    errorText.length,
    6,
    "Error text should be exactly 6 characters",
  );

  console.log(`✅ Trailing space is correctly excluded from error range`);
});

Deno.test("Paste highlighting - error indices match actual word boundaries", () => {
  const text =
    " UNOHAS DAHKU: - Unohas dahkku go Magnhild Mathisena eai dohkkehan, lohket Magnhilda bellodatolbmot.";

  // Find word boundaries for "dahkku"
  const errorWord = "dahkku";
  const startIndex = text.indexOf(errorWord);
  const endIndex = startIndex + errorWord.length;

  // Verify indices
  assertEquals(startIndex, 24, "Error word starts at index 24");
  assertEquals(endIndex, 30, "Error word ends at index 30");

  // Extract text using these indices
  const extractedText = text.substring(startIndex, endIndex);

  // Verify it matches the error word exactly
  assertEquals(
    extractedText,
    errorWord,
    "Text extracted using indices should match error word exactly",
  );

  // Verify no leading/trailing whitespace
  assertEquals(
    extractedText.trim(),
    extractedText,
    "Extracted text should have no leading or trailing whitespace",
  );

  console.log(
    `✅ Error indices [${startIndex}, ${endIndex}) correctly bound the word`,
  );
});

Deno.test("Paste highlighting - API trims leading space and returns adjusted indices", () => {
  // Original text we send to API (with leading space)
  const originalText =
    " UNOHAS DAHKU: - Unohas dahkku go Magnhild Mathisena eai dohkkehan, lohket Magnhilda bellodatolbmot.";

  // API trims the text and returns the trimmed version
  const apiReturnedText =
    "UNOHAS DAHKU: - Unohas dahkku go Magnhild Mathisena eai dohkkehan, lohket Magnhilda bellodatolbmot.";

  // Calculate how much was trimmed
  const trimOffset = originalText.length - apiReturnedText.length;
  assertEquals(trimOffset, 1, "API trimmed 1 leading space");

  // API returns error at indices 23-29 (relative to trimmed text)
  const apiErrorStartIndex = 23;
  const apiErrorEndIndex = 29;

  // Verify the API error indices point to correct text in API's trimmed version
  assertEquals(
    apiReturnedText.substring(apiErrorStartIndex, apiErrorEndIndex),
    "dahkku",
    "API indices are correct for trimmed text",
  );

  // We need to adjust by the trim offset to get indices for original text
  const adjustedStartIndex = apiErrorStartIndex + trimOffset;
  const adjustedEndIndex = apiErrorEndIndex + trimOffset;

  assertEquals(adjustedStartIndex, 24, "Adjusted start index should be 24");
  assertEquals(adjustedEndIndex, 30, "Adjusted end index should be 30");

  // Verify adjusted indices point to correct text in original
  const highlightedText = originalText.substring(
    adjustedStartIndex,
    adjustedEndIndex,
  );
  assertEquals(
    highlightedText,
    "dahkku",
    "Adjusted indices should highlight correct text in original",
  );

  console.log(
    `✅ API trimmed ${trimOffset} chars, adjusted indices from ${apiErrorStartIndex}-${apiErrorEndIndex} to ${adjustedStartIndex}-${adjustedEndIndex}`,
  );
});

Deno.test("Multi-line paste - first line with no leading space", () => {
  // Multi-line text: "Dqll.\n Dqll. In die'e wat.\n..."
  // Line 0: "Dqll.\n" - no leading space
  const fullText = "Dqll.\n Dqll. In die'e wat.\nSeammás le";

  // Line 0 starts at position 0
  const line0Start = 0;

  // API returns error at 0-4 for "Dqll"
  const apiStartIndex = 0;
  const apiEndIndex = 4;

  // No trim offset for line 0 (no leading space)
  const trimOffset = 0;

  // Adjusted indices = API indices + documentOffset + trimOffset
  const adjustedStartIndex = apiStartIndex + line0Start + trimOffset;
  const adjustedEndIndex = apiEndIndex + line0Start + trimOffset;

  assertEquals(adjustedStartIndex, 0, "Line 0 error should start at 0");
  assertEquals(adjustedEndIndex, 4, "Line 0 error should end at 4");

  // Verify highlighted text
  const highlightedText = fullText.substring(
    adjustedStartIndex,
    adjustedEndIndex,
  );
  assertEquals(highlightedText, "Dqll", "Should highlight 'Dqll' on line 0");

  console.log(
    `✅ Line 0 (no leading space): error at ${adjustedStartIndex}-${adjustedEndIndex}`,
  );
});

Deno.test("Multi-line paste - second line with leading space", () => {
  // Multi-line text: "Dqll.\n Dqll. In die'e wat.\n..."
  // Line 1: " Dqll. In die'e wat.\n" - has 1 leading space
  const fullText = "Dqll.\n Dqll. In die'e wat.\nSeammás le";
  const line1 = " Dqll. In die'e wat.";

  // Line 1 starts at position 6 (after "Dqll.\n")
  const line1Start = 6;

  // Calculate leading whitespace
  const leadingWhitespace = line1.length - line1.trimStart().length;
  assertEquals(leadingWhitespace, 1, "Line 1 has 1 leading space");

  // API trims leading space and returns error at 0-4 (relative to "Dqll. In die'e wat.")
  const apiStartIndex = 0;
  const apiEndIndex = 4;

  // API trimmed the leading space, so trimOffset = 1
  const apiText = line1.trimStart(); // "Dqll. In die'e wat."
  const apiLeadingWhitespace = apiText.length - apiText.trimStart().length;
  const trimOffset = leadingWhitespace - apiLeadingWhitespace;
  assertEquals(trimOffset, 1, "Trim offset should be 1");

  // Adjusted indices = API indices + documentOffset + trimOffset
  const adjustedStartIndex = apiStartIndex + line1Start + trimOffset;
  const adjustedEndIndex = apiEndIndex + line1Start + trimOffset;

  // Should be 0 + 6 + 1 = 7 to 4 + 6 + 1 = 11
  assertEquals(adjustedStartIndex, 7, "Line 1 error should start at 7");
  assertEquals(adjustedEndIndex, 11, "Line 1 error should end at 11");

  // Verify highlighted text
  const highlightedText = fullText.substring(
    adjustedStartIndex,
    adjustedEndIndex,
  );
  assertEquals(highlightedText, "Dqll", "Should highlight 'Dqll' on line 1");

  console.log(
    `✅ Line 1 (1 leading space): error at ${adjustedStartIndex}-${adjustedEndIndex}`,
  );
});

Deno.test("Multi-line paste - third line with no leading space", () => {
  // Multi-line text: "Dqll.\n Dqll. In die'e wat.\nSeammás le..."
  // Line 2: "Seammás le..." - no leading space
  const fullText = "Dqll.\n Dqll. In die'e wat.\nSeammás le";

  // Line 2 starts at position 27 (after "Dqll.\n Dqll. In die'e wat.\n")
  const line2Start = 27;

  // API returns error at some position (let's say 0-7 for "Seammás")
  const apiStartIndex = 0;
  const apiEndIndex = 7;

  // No trim offset
  const trimOffset = 0;

  // Adjusted indices = API indices + documentOffset + trimOffset
  const adjustedStartIndex = apiStartIndex + line2Start + trimOffset;
  const adjustedEndIndex = apiEndIndex + line2Start + trimOffset;

  assertEquals(adjustedStartIndex, 27, "Line 2 error should start at 27");
  assertEquals(adjustedEndIndex, 34, "Line 2 error should end at 34");

  // Verify highlighted text
  const highlightedText = fullText.substring(
    adjustedStartIndex,
    adjustedEndIndex,
  );
  assertEquals(
    highlightedText,
    "Seammás",
    "Should highlight 'Seammás' on line 2",
  );

  console.log(
    `✅ Line 2 (no leading space): error at ${adjustedStartIndex}-${adjustedEndIndex}`,
  );
});
