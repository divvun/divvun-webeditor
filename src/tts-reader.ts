/**
 * Text-to-Speech Reader with line-by-line highlighting and caching
 */

import type { SupportedLanguage, TTSVoice } from "./types.ts";
import { TextToSpeechAPI } from "./api.ts";

interface CacheKey {
  text: string;
  language: string;
  voice: string;
}

interface ReadingState {
  currentLine: number;
  isPlaying: boolean;
  isPaused: boolean;
}

export class TTSReader {
  private ttsApi: TextToSpeechAPI;
  private audioCache = new Map<string, Blob>();
  private currentAudio: HTMLAudioElement | null = null;
  private state: ReadingState = {
    currentLine: 0,
    isPlaying: false,
    isPaused: false,
  };

  // Callbacks
  private onLineHighlight?: (lineIndex: number) => void;
  private onReadingComplete?: () => void;
  private onReadingStop?: () => void;
  private onError?: (error: Error) => void;

  constructor(
    onLineHighlight?: (lineIndex: number) => void,
    onReadingComplete?: () => void,
    onReadingStop?: () => void,
    onError?: (error: Error) => void,
  ) {
    this.ttsApi = new TextToSpeechAPI();
    this.onLineHighlight = onLineHighlight;
    this.onReadingComplete = onReadingComplete;
    this.onReadingStop = onReadingStop;
    this.onError = onError;
  }

  /**
   * Generate cache key for a line
   */
  private getCacheKey(text: string, language: string, voice: string): string {
    return `${language}:${voice}:${text}`;
  }

  /**
   * Get audio for a line (from cache or API)
   */
  private async getAudioForLine(
    text: string,
    language: SupportedLanguage,
    voice: string,
  ): Promise<Blob> {
    const cacheKey = this.getCacheKey(text, language, voice);

    // Check cache first
    const cached = this.audioCache.get(cacheKey);
    if (cached) {
      console.debug(`📦 TTS cache hit for: "${text.substring(0, 30)}..."`);
      return cached;
    }

    // Fetch from API
    console.debug(`🔊 TTS cache miss, fetching: "${text.substring(0, 30)}..."`);
    const audioBlob = await this.ttsApi.synthesize(text, language, voice);

    // Store in cache
    this.audioCache.set(cacheKey, audioBlob);

    return audioBlob;
  }

  /**
   * Read a single line
   */
  private readLine(
    text: string,
    language: SupportedLanguage,
    voice: string,
    onPlaybackStart?: () => void,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      // Get audio (cached or fresh)
      this.getAudioForLine(text, language, voice).then((audioBlob) => {
        // Stop any currently playing audio first
        if (this.currentAudio) {
          this.currentAudio.pause();
          this.currentAudio = null;
        }

        // Create audio element with blob URL
        const blobUrl = URL.createObjectURL(audioBlob);
        const audio = new Audio(blobUrl);

        // Preload the audio to ensure it's ready
        audio.preload = "auto";

        // Set up event listeners BEFORE playing
        audio.onended = () => {
          console.debug("✅ Audio playback completed");
          URL.revokeObjectURL(blobUrl);
          if (this.currentAudio === audio) {
            this.currentAudio = null;
          }
          resolve();
        };

        audio.onerror = () => {
          URL.revokeObjectURL(blobUrl);
          if (this.currentAudio === audio) {
            this.currentAudio = null;
          }

          // Check if it was aborted (user stopped reading)
          if (audio.error?.code === MediaError.MEDIA_ERR_ABORTED) {
            console.debug("⏸️ Audio playback aborted");
            resolve(); // Resolve instead of reject for user-initiated stops
          } else {
            reject(
              new Error(
                `Audio playback failed: ${
                  audio.error?.message || "Unknown error"
                }`,
              ),
            );
          }
        };

        // Handle abort event specifically
        audio.onabort = () => {
          URL.revokeObjectURL(blobUrl);
          if (this.currentAudio === audio) {
            this.currentAudio = null;
          }
          console.debug("⏸️ Audio playback aborted");
          resolve(); // User stopped, not an error
        };

        // Wait for audio to be loaded before playing
        audio.oncanplaythrough = () => {
          console.debug("🎵 Audio loaded and ready to play");

          // Now play the audio since it's fully loaded
          audio.play()
            .then(() => {
              console.debug(
                "▶️ Audio playback started, waiting for completion...",
              );
              // Only set as current audio after play() succeeds
              this.currentAudio = audio;

              // Call the callback when playback actually starts
              if (onPlaybackStart) {
                console.debug("🎯 Calling highlight callback");
                onPlaybackStart();
              }
              // The resolve() will be called by onended when playback finishes
            })
            .catch((error) => {
              // Clean up and handle play errors
              console.debug("⚠️ Audio play() failed:", error);
              URL.revokeObjectURL(blobUrl);
              if (this.currentAudio === audio) {
                this.currentAudio = null;
              }

              // Check if it's an abort exception
              if (
                error instanceof DOMException && error.name === "AbortError"
              ) {
                console.debug("⏸️ Audio play aborted");
                resolve(); // User stopped, not an error
              } else {
                reject(error);
              }
            });
        };

        // Load the audio - this will trigger oncanplaythrough when ready
        audio.load();
      }).catch(reject);
    });
  }

  /**
   * Start reading from a specific line
   */
  async read(
    lines: string[],
    language: SupportedLanguage,
    voice: string,
    startLine = 0,
  ): Promise<void> {
    if (this.state.isPlaying) {
      console.warn("Already reading, stop first before starting new reading");
      return;
    }

    this.state.isPlaying = true;
    this.state.isPaused = false;
    this.state.currentLine = startLine;

    try {
      for (let i = startLine; i < lines.length; i++) {
        // Check if stopped
        if (!this.state.isPlaying) {
          break;
        }

        const line = lines[i].trim();

        // Skip empty lines
        if (!line) {
          continue;
        }

        this.state.currentLine = i;

        // Read the line - highlight when playback actually starts
        await this.readLine(line, language, voice, () => {
          // Highlight when audio starts playing
          this.onLineHighlight?.(i);
        });
      }

      // Completed successfully
      if (this.state.isPlaying) {
        this.state.isPlaying = false;
        this.state.currentLine = 0;
        this.onReadingComplete?.();
      }
    } catch (error) {
      this.state.isPlaying = false;
      const err = error instanceof Error ? error : new Error(String(error));
      this.onError?.(err);
      throw err;
    }
  }

  /**
   * Stop reading
   */
  stop(): void {
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio = null;
    }

    const wasPlaying = this.state.isPlaying;
    this.state.isPlaying = false;
    this.state.isPaused = true;

    if (wasPlaying) {
      this.onReadingStop?.();
    }
  }

  /**
   * Continue reading from where it was stopped
   */
  async continue(
    lines: string[],
    language: SupportedLanguage,
    voice: string,
  ): Promise<void> {
    if (!this.state.isPaused) {
      console.warn("Not paused, cannot continue");
      return;
    }

    this.state.isPaused = false;
    await this.read(lines, language, voice, this.state.currentLine);
  }

  /**
   * Read from the beginning
   */
  async readFromStart(
    lines: string[],
    language: SupportedLanguage,
    voice: string,
  ): Promise<void> {
    this.stop();
    this.state.currentLine = 0;
    this.state.isPaused = false;
    await this.read(lines, language, voice, 0);
  }

  /**
   * Get current state
   */
  getState(): ReadingState {
    return { ...this.state };
  }

  /**
   * Check if currently reading
   */
  isReading(): boolean {
    return this.state.isPlaying;
  }

  /**
   * Check if paused
   */
  isPaused(): boolean {
    return this.state.isPaused;
  }

  /**
   * Get cache size
   */
  getCacheSize(): number {
    return this.audioCache.size;
  }

  /**
   * Clear audio cache
   */
  clearCache(): void {
    this.audioCache.clear();
    console.log("🗑️ TTS audio cache cleared");
  }
}
