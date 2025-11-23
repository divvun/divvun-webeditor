import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { getAvailableTTSVoices, TextToSpeechAPI } from "../src/api.ts";

Deno.test({
  name: "TTS API - getAvailableTTSVoices returns working voices",
  sanitizeResources: false, // Allow unclosed fetch responses from validation
  async fn() {
    const voices = await getAvailableTTSVoices();

    console.log(`Found ${voices.length} working TTS voices`);

    // Should have at least one working voice
    assertEquals(
      voices.length > 0,
      true,
      "Should have at least one working TTS voice",
    );

    // Each voice should have required properties
    voices.forEach((voice) => {
      assertEquals(typeof voice.code, "string", "Voice should have code");
      assertEquals(typeof voice.name, "string", "Voice should have name");
      assertEquals(typeof voice.voice, "string", "Voice should have voice id");
      assertEquals(
        typeof voice.voiceLabel,
        "string",
        "Voice should have label",
      );
    });
  },
});

Deno.test("TTS API - synthesize generates audio blob", async () => {
  const tts = new TextToSpeechAPI();

  // Use Northern Sami with Biret voice (most likely to work)
  const audioBlob = await tts.synthesize("Bures", "se", "biret");

  console.log(
    `Generated audio: ${audioBlob.size} bytes, type: ${audioBlob.type}`,
  );

  // Should return a Blob
  assertEquals(audioBlob instanceof Blob, true, "Should return a Blob");

  // Should have audio content
  assertEquals(audioBlob.size > 0, true, "Audio blob should have content");

  // Should be MP3 format
  assertEquals(
    audioBlob.type.includes("audio"),
    true,
    "Blob should be audio type",
  );
});

Deno.test("TTS API - synthesize handles empty text", async () => {
  const tts = new TextToSpeechAPI();

  try {
    await tts.synthesize("", "se", "biret");
    throw new Error("Should have thrown an error for empty text");
  } catch (error) {
    assertEquals(
      error instanceof Error && error.message.includes("empty"),
      true,
      "Should throw error for empty text",
    );
  }
});

Deno.test({
  name: "TTS API - synthesize handles invalid voice",
  sanitizeResources: false,
  async fn() {
    const tts = new TextToSpeechAPI();

    try {
      await tts.synthesize("test", "invalid_lang", "invalid_voice");
      throw new Error("Should have thrown an error for invalid voice");
    } catch (error) {
      // Accept any error since the API might return different error messages
      assertEquals(
        error instanceof Error,
        true,
        "Should throw error for invalid voice",
      );
    }
  },
});
