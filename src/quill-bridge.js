(() => {
  const Q = globalThis.Quill;
  if (!Q) {
    // Defer throwing so page can still load; will throw when create() is called
    globalThis.QuillBridge = {
      create: () => {
        throw new Error(
          "Quill is not loaded. Include Quill CDN before using the bridge."
        );
      },
    };
    return;
  }

  const bridge = {
    create(container, options) {
      const el =
        typeof container === "string"
          ? document.getElementById(container)
          : container;
      if (!el) throw new Error("QuillBridge.create: container not found");
      const quill = new Q(el, options || {});

      return {
        root: quill.root,
        getText: () => quill.getText(),
        on: (ev, handler) => quill.on(ev, handler),
        getLength: () => quill.getLength(),
        formatText: (i, len, format, value) =>
          quill.formatText(i, len, format, value),
        setText: (text) => {
          quill.setText(text);
        },
        deleteText: (i, len) => quill.deleteText(i, len),
        insertText: (i, text) => quill.insertText(i, text),
        focus: () => quill.focus(),
        // helpers using Quill internals
        findBlot: (node) => Q.find(node),
        getIndex: (blot) => quill.getIndex(blot),
      };
    },
  };

  globalThis.QuillBridge = bridge;
})();
