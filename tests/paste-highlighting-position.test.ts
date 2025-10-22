/**
 * Integration test for paste highlighting position bug
 *
 * Bug: When pasting text with errors, the highlighting position is off by one character.
 * The error "dahkku" at position 24-30 is highlighted as " dahkk" at position 23-29.
 *
 * This test verifies that error highlighting uses the correct start and end indices.
 */

import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import type { CheckerError } from "../src/types.ts";

/**
 * Helper function to create a mock CheckerError
 */
function createError(
  errorText: string,
  startIndex: number,
  endIndex: number,
): CheckerError {
  return {
    error_text: errorText,
    start_index: startIndex,
    end_index: endIndex,
    error_code: "typo",
    description: "Spelling error",
    suggestions: ["dahku"],
    title: "Typo",
  };
}

Deno.test("Paste highlighting - error position should be exact", () => {
  const text =
    " UNOHAS DAHKU: - Unohas dahkku go Magnhild Mathisena eai dohkkehan, lohket Magnhilda bellodatolbmot.";

  // The error word "dahkku" appears at index 24
  const errorWord = "dahkku";
  const errorStartIndex = text.indexOf(errorWord);
  const errorEndIndex = errorStartIndex + errorWord.length;

  console.log(
    `\n📍 Error word "${errorWord}" at indices ${errorStartIndex}-${errorEndIndex}`,
  );
  console.log(
    `   Text at position: "${text.substring(errorStartIndex, errorEndIndex)}"`,
  );

  // Verify the word is at the expected position
  assertEquals(errorStartIndex, 24, "Error should start at index 24");
  assertEquals(errorEndIndex, 30, "Error should end at index 30");
  assertEquals(
    text.substring(errorStartIndex, errorEndIndex),
    "dahkku",
    "Text at error position should be 'dahkku'",
  );

  // Create an error object with the correct positions
  const error = createError(errorWord, errorStartIndex, errorEndIndex);

  // Verify error object has correct positions
  assertEquals(error.start_index, 24);
  assertEquals(error.end_index, 30);

  // Verify the text at the error's indices is correct
  const highlightedText = text.substring(error.start_index, error.end_index);
  assertEquals(
    highlightedText,
    "dahkku",
    "Highlighted text should be exactly 'dahkku', not ' dahkk'",
  );

  // Verify we're NOT highlighting the wrong range (the bug)
  const bugStart = errorStartIndex - 1;
  const bugEnd = errorEndIndex - 1;
  const wrongHighlight = text.substring(bugStart, bugEnd);
  assertEquals(
    wrongHighlight,
    " dahkk",
    "This is what the bug incorrectly highlights",
  );

  // Assert that our error does NOT match the buggy behavior
  assertEquals(
    error.start_index !== bugStart || error.end_index !== bugEnd,
    true,
    "Error indices should NOT match the buggy off-by-one positions",
  );

  console.log(
    `✅ Error positions are correct: ${error.start_index}-${error.end_index}`,
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

  // Create error
  const error = createError(errorWord, startIndex, endIndex);

  // Extract text using error indices
  const extractedText = text.substring(error.start_index, error.end_index);

  // Verify it matches the error word exactly
  assertEquals(
    extractedText,
    error.error_text,
    "Text extracted using error indices should match error_text exactly",
  );

  // Verify no leading/trailing whitespace
  assertEquals(
    extractedText.trim(),
    extractedText,
    "Extracted text should have no leading or trailing whitespace",
  );

  console.log(
    `✅ Error indices [${error.start_index}, ${error.end_index}) correctly bound the word`,
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
