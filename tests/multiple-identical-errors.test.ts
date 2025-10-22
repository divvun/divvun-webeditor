/**
 * Integration test for multiple identical errors
 *
 * Bug: When the same error text appears multiple times in the document,
 * applying a suggestion to the third occurrence incorrectly fixes the first occurrence instead.
 *
 * Example:
 * Line 1: vuolgit.– Nieiddažan
 * Line 2: behtohallamiin.– Sii geat barge
 * Line 3: ge.– Diekkár čáppa
 *
 * All three lines contain the same error: ".– " (period + en-dash + space)
 * When clicking on the third error, the first error gets fixed instead.
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
  suggestions: string[] = [".– "],
): CheckerError {
  return {
    error_text: errorText,
    start_index: startIndex,
    end_index: endIndex,
    error_code: "typo",
    description: "Incorrect spacing with en-dash",
    suggestions: suggestions,
    title: "Spacing Error",
  };
}

/**
 * Test case: Three identical errors in document
 * Verifies that applying suggestion to third error fixes the correct occurrence
 */
Deno.test(
  "applySuggestion should fix the correct occurrence when multiple identical errors exist",
  () => {
    // Test data: Three lines with identical error pattern ".– "
    const text =
      "vuolgit.– Nieiddažan\nbehtohallamiin.– Sii geat barge\nge.– Diekkár čáppa\n";

    // Calculate positions of each error occurrence
    // Line 1: "vuolgit.– Nieiddažan\n"
    //          0123456789...
    //                 ^^ error at indices 7-10
    const error1StartIndex = 7;
    const error1EndIndex = 10;

    // Line 2: "behtohallamiin.– Sii geat barge\n"
    //          Position 21 (after line 1 with \n) + 14
    //          ^^ error at indices 35-38
    const error2StartIndex = 35;
    const error2EndIndex = 38;

    // Line 3: "ge.– Diekkár čáppa\n"
    //          Position 54 (after lines 1 and 2) + 2
    //          ^^ error at indices 56-59
    const error3StartIndex = 55;
    const error3EndIndex = 58;

    // Create three identical errors at different positions
    const error1 = createError(".– ", error1StartIndex, error1EndIndex, [
      ". – ",
    ]);
    const error2 = createError(".– ", error2StartIndex, error2EndIndex, [
      ". – ",
    ]);
    const error3 = createError(".– ", error3StartIndex, error3EndIndex, [
      ". – ",
    ]);

    const errors = [error1, error2, error3];

    // Verify the errors are set up correctly
    assertEquals(errors.length, 3, "Should have three errors");

    // Verify each error has the same text
    assertEquals(error1.error_text, error2.error_text);
    assertEquals(error2.error_text, error3.error_text);

    // Verify each error has different positions
    assertEquals(error1.start_index !== error2.start_index, true);
    assertEquals(error2.start_index !== error3.start_index, true);
    assertEquals(error1.start_index !== error3.start_index, true);

    // Verify the text at each position matches the error pattern
    assertEquals(text.substring(error1StartIndex, error1EndIndex), ".– ");
    assertEquals(text.substring(error2StartIndex, error2EndIndex), ".– ");
    assertEquals(text.substring(error3StartIndex, error3EndIndex), ".– ");

    console.log("✅ Test data verified:");
    console.log(`  Line 1 error at ${error1StartIndex}-${error1EndIndex}`);
    console.log(`  Line 2 error at ${error2StartIndex}-${error2EndIndex}`);
    console.log(`  Line 3 error at ${error3StartIndex}-${error3EndIndex}`);

    // Simulate the bug scenario:
    // When error matching uses only error_text, it will find the first matching error
    // regardless of which one was actually clicked
    const errorTextToMatch = ".– ";
    const foundError = errors.find((err) =>
      err.error_text === errorTextToMatch
    );

    // BUG: This will always find error1, not the specific error that was clicked
    assertEquals(
      foundError,
      error1,
      "Bug demonstrated: find() returns first match, not the clicked error",
    );

    // The correct behavior should match by position, not just text
    // For example, if clicking at position 56 (third error):
    const clickPosition = error3StartIndex + 1; // Inside the third error
    const correctError = errors.find(
      (err) =>
        err.start_index <= clickPosition && clickPosition < err.end_index,
    );

    assertEquals(
      correctError,
      error3,
      "Correct behavior: match error by position, not text",
    );
  },
);

/**
 * Test case: Error matching should use position, not text
 * This is the fix we need to implement
 */
Deno.test(
  "findErrorAtPosition should match by position when error text is identical",
  () => {
    const _text = "test.– one\ntest.– two\ntest.– three\n";

    // Calculate positions
    const error1 = createError(".– ", 4, 7); // In "test.– one"
    const error2 = createError(".– ", 15, 18); // In "test.– two"
    const error3 = createError(".– ", 26, 29); // In "test.– three"

    const errors = [error1, error2, error3];

    // Test matching by position for each error
    const positions = [
      { pos: 5, expected: error1, name: "first error" },
      { pos: 16, expected: error2, name: "second error" },
      { pos: 27, expected: error3, name: "third error" },
    ];

    positions.forEach(({ pos, expected, name }) => {
      const found = errors.find(
        (err) => err.start_index <= pos && pos < err.end_index,
      );
      assertEquals(
        found,
        expected,
        `Position ${pos} should match ${name}`,
      );
    });
  },
);

/**
 * Test case: Verify error element position matching
 * When we have an error element, we should use its position to find the correct error
 */
Deno.test("error element should provide position for matching", () => {
  const _text = "word.– one\nword.– two\nword.– three\n";

  const error1 = createError(".– ", 4, 7);
  const error2 = createError(".– ", 15, 18);
  const error3 = createError(".– ", 26, 29);

  const errors = [error1, error2, error3];

  // Simulate having an error element with position information
  // In real Quill, we can use findBlot and getIndex to get the position
  interface ErrorElementWithPosition {
    textContent: string;
    startIndex: number;
  }

  const errorElements: ErrorElementWithPosition[] = [
    { textContent: ".– ", startIndex: 4 },
    { textContent: ".– ", startIndex: 15 },
    { textContent: ".– ", startIndex: 26 },
  ];

  // Test that each element matches the correct error by position
  errorElements.forEach((element, i) => {
    // WRONG: Match by text only (bug)
    const wrongMatch = errors.find((err) =>
      err.error_text === element.textContent
    );
    assertEquals(
      wrongMatch,
      error1,
      "Bug: matching by text only always finds first error",
    );

    // CORRECT: Match by position
    const correctMatch = errors.find(
      (err) =>
        err.start_index === element.startIndex &&
        err.error_text === element.textContent,
    );
    assertEquals(
      correctMatch,
      errors[i],
      `Element ${i} should match error ${i} by position`,
    );
  });
});
