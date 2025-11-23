export default function TTSButton() {
  // Client-side script to handle TTS functionality
  const handleTTS = `
    (function() {
      let ttsReader = null;
      let currentVoice = null;
      let availableVoices = [];
      
      // Initialize TTS
      async function initializeTTS() {
        try {
          const { getAvailableTTSVoices } = await import('/api.js');
          const { TTSReader } = await import('/tts-reader.js');
          
          // Get available voices (no longer async)
          availableVoices = getAvailableTTSVoices();
          
          if (availableVoices.length === 0) {
            console.warn('No TTS voices available');
            hideTTSButton();
            return;
          }
          
          console.log(\`✅ Found \${availableVoices.length} TTS voices\`);
          
          // Get current language from URL
          const urlParams = new URLSearchParams(globalThis.location.search);
          const currentLang = urlParams.get('lang') || 'se';
          
          // Find matching voice for current language
          currentVoice = availableVoices.find(v => v.code === currentLang);
          
          if (!currentVoice) {
            // Use first available voice as fallback
            currentVoice = availableVoices[0];
          }
          
          if (currentVoice) {
            showTTSButton();
            
            // Create TTS reader with callbacks
            ttsReader = new TTSReader(
              highlightLine,
              onReadingComplete,
              onReadingStop,
              onReadingError
            );
          } else {
            hideTTSButton();
          }
        } catch (error) {
          console.error('Failed to initialize TTS:', error);
          hideTTSButton();
        }
      }
      
      // Show TTS button
      function showTTSButton() {
        const btn = document.getElementById('tts-button');
        if (btn) {
          btn.style.display = 'block';
        }
      }
      
      // Hide TTS button
      function hideTTSButton() {
        const btn = document.getElementById('tts-button');
        if (btn) {
          btn.style.display = 'none';
        }
      }
      
      // Get text lines from text checker (checked/analyzed text)
      function getEditorLines() {
        const textChecker = globalThis.textChecker;
        if (!textChecker) {
          console.error('TextChecker not available');
          return [];
        }
        
        const text = textChecker.getText();
        return text.split('\\n').filter(line => line.trim().length > 0);
      }
      
      // Highlight a specific line
      function highlightLine(lineIndex) {
        const editor = globalThis.editor;
        const textChecker = globalThis.textChecker;
        if (!editor || !textChecker) return;
        
        // Remove previous highlight
        removeLineHighlight();
        
        // Add highlight to current line
        const text = textChecker.getText();
        const lines = text.split('\\n');
        
        let startIndex = 0;
        for (let i = 0; i < lineIndex; i++) {
          startIndex += lines[i].length + 1; // +1 for newline
        }
        
        const lineLength = lines[lineIndex].length;
        
        // Format the line with a highlight color (use 'silent' to not trigger text-change events)
        editor.formatText(startIndex, lineLength, 'background', '#FFEB3B', 'silent');
        
        console.log(\`🎯 Highlighting line \${lineIndex}\`);
      }
      
      // Remove line highlight
      function removeLineHighlight() {
        const editor = globalThis.editor;
        const textChecker = globalThis.textChecker;
        if (!editor || !textChecker) return;
        
        const text = textChecker.getText();
        editor.formatText(0, text.length, 'background', false, 'silent');
      }
      
      // Reading complete callback
      function onReadingComplete() {
        console.log('✅ Reading completed');
        removeLineHighlight();
        updateButtonState('idle');
      }
      
      // Reading stopped callback
      function onReadingStop() {
        console.log('⏸️ Reading stopped');
        updateButtonState('paused');
      }
      
      // Error callback
      function onReadingError(error) {
        console.error('❌ Reading error:', error);
        removeLineHighlight();
        updateButtonState('idle');
        alert('Failed to read text: ' + error.message);
      }
      
      // Update button state
      function updateButtonState(state) {
        const btnRead = document.getElementById('tts-read-btn');
        const btnContinue = document.getElementById('tts-continue-btn');
        const btnRestart = document.getElementById('tts-restart-btn');
        const btnStop = document.getElementById('tts-stop-btn');
        
        if (!btnRead) return;
        
        // Hide all buttons first
        btnRead.style.display = 'none';
        if (btnContinue) btnContinue.style.display = 'none';
        if (btnRestart) btnRestart.style.display = 'none';
        if (btnStop) btnStop.style.display = 'none';
        
        switch (state) {
          case 'idle':
            btnRead.style.display = 'inline-flex';
            break;
          case 'playing':
            if (btnStop) btnStop.style.display = 'inline-flex';
            break;
          case 'paused':
            if (btnContinue) btnContinue.style.display = 'inline-flex';
            if (btnRestart) btnRestart.style.display = 'inline-flex';
            break;
        }
      }
      
      // Read text button click
      async function onReadClick() {
        if (!ttsReader || !currentVoice) return;
        
        const lines = getEditorLines();
        if (lines.length === 0) {
          alert('No text to read');
          return;
        }
        
        updateButtonState('playing');
        
        try {
          await ttsReader.read(lines, currentVoice.code, currentVoice.voice);
        } catch (error) {
          console.error('Reading failed:', error);
        }
      }
      
      // Stop button click
      function onStopClick() {
        if (!ttsReader) return;
        ttsReader.stop();
      }
      
      // Continue button click
      async function onContinueClick() {
        if (!ttsReader || !currentVoice) return;
        
        const lines = getEditorLines();
        updateButtonState('playing');
        
        try {
          await ttsReader.continue(lines, currentVoice.code, currentVoice.voice);
        } catch (error) {
          console.error('Continue failed:', error);
        }
      }
      
      // Restart button click
      async function onRestartClick() {
        if (!ttsReader || !currentVoice) return;
        
        const lines = getEditorLines();
        updateButtonState('playing');
        
        try {
          await ttsReader.readFromStart(lines, currentVoice.code, currentVoice.voice);
        } catch (error) {
          console.error('Restart failed:', error);
        }
      }
      
      // Attach event listeners
      function attachEventListeners() {
        const btnRead = document.getElementById('tts-read-btn');
        const btnStop = document.getElementById('tts-stop-btn');
        const btnContinue = document.getElementById('tts-continue-btn');
        const btnRestart = document.getElementById('tts-restart-btn');
        
        if (btnRead) btnRead.addEventListener('click', onReadClick);
        if (btnStop) btnStop.addEventListener('click', onStopClick);
        if (btnContinue) btnContinue.addEventListener('click', onContinueClick);
        if (btnRestart) btnRestart.addEventListener('click', onRestartClick);
      }
      
      // Initialize on DOM ready
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
          attachEventListeners();
          initializeTTS();
        });
      } else {
        attachEventListeners();
        initializeTTS();
      }
      
      // Listen for language changes
      globalThis.addEventListener('languageChanged', (event) => {
        const detail = event.detail;
        const newLang = detail.language;
        
        // Find voice for new language
        const newVoice = availableVoices.find(v => v.code === newLang);
        if (newVoice) {
          currentVoice = newVoice;
          console.log(\`🔊 Switched TTS voice to \${newVoice.voiceLabel} (\${newLang})\`);
          
          // Clear cache when language changes
          if (ttsReader) {
            ttsReader.clearCache();
          }
        } else {
          console.warn(\`No TTS voice available for language: \${newLang}\`);
        }
      });
    })();
  `;

  return (
    <>
      <div
        id="tts-button"
        className="flex items-center gap-2"
        style={{ display: "none" }}
      >
        <button
          type="button"
          id="tts-read-btn"
          className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors flex items-center gap-2"
          title="Read this text aloud"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"
            />
          </svg>
          Read Text
        </button>

        <button
          type="button"
          id="tts-stop-btn"
          className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors flex items-center gap-2"
          style={{ display: "none" }}
          title="Stop reading"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
          Stop
        </button>

        <button
          type="button"
          id="tts-continue-btn"
          className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors flex items-center gap-2"
          style={{ display: "none" }}
          title="Continue reading"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          Continue
        </button>

        <button
          type="button"
          id="tts-restart-btn"
          className="px-4 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600 transition-colors flex items-center gap-2"
          style={{ display: "none" }}
          title="Read from start"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
          Restart
        </button>
      </div>

      <script dangerouslySetInnerHTML={{ __html: handleTTS }} />
    </>
  );
}
