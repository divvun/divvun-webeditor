---
title: Divvun grammar and spell checker
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
