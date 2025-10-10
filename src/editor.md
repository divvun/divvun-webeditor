---
title: Quill Editor Demo
description: Advanced grammar and spell checking for Sami languages and Faroese
layout: layout.vto
url: /editor.html
---

<div class="controls">
  <div class="control-group">
    <label for="language-select">Language:</label>
    <select id="language-select">
      <option value="se">Davvisámegiella (Northern Sami)</option>
      <option value="sma">Åarjelsaemien (Southern Sami)</option>
      <option value="smj">Julevsámegiella (Lule Sami)</option>
      <option value="fao">Føroyskt (Faroese)</option>
    </select>
  </div>
  <div class="control-group">
    <button id="check-btn">Check Grammar</button>
    <button id="clear-btn">Clear</button>
  </div>
</div>
<div class="editor-container">
  <div id="editor" class="quill-editor"></div>
</div>
<div class="status-bar">
  <div class="status" id="status-display">
    <span id="status-text">Ready</span>
  </div>
  <div class="error-count" id="error-count">0 errors</div>
</div>
<script type="module">
  import { checkGrammar } from "./api.ts";

  const quill = new Quill("#editor", {
    theme: "snow",
  });

  const checkBtn = document.getElementById("check-btn");
  const clearBtn = document.getElementById("clear-btn");
  const statusText = document.getElementById("status-text");
  const errorCount = document.getElementById("error-count");
  const languageSelect = document.getElementById("language-select");

  checkBtn.addEventListener("click", async () => {
    statusText.textContent = "Checking...";
    const text = quill.getText();
    const lang = languageSelect.value;
    try {
      const result = await checkGrammar(text, lang);
      // Example: result.errors = [{offset, length, type}]
      let count = result.errors?.length || 0;
      errorCount.textContent = `${count} error${count !== 1 ? "s" : ""}`;
      statusText.textContent = "Complete";
      // Highlight errors in Quill (implement as needed)
    } catch (e) {
      statusText.textContent = "Error";
      errorCount.textContent = "0 errors";
    }
  });

  clearBtn.addEventListener("click", () => {
    quill.setText("");
    errorCount.textContent = "0 errors";
    statusText.textContent = "Ready";
  });
</script>