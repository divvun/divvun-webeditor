# Divvun TextChecker Webeditor

A static site with a Quill editor integrated with the Divvun Grammar API for real-time grammar checking in Sami languages and Faroese.

## Features

- Quill.js rich text editor
- Real-time grammar checking with wavy underlines (red for typos, blue for other errors)
- Custom context menu with correction suggestions
- Support for Northern Sami, Southern Sami, Lule Sami, and Faroese
- Check-as-you-type with 800ms debounce
- Disabled native spellcheck

## Commands

This project uses Deno and Lume for building and serving.

### Build the site

```bash
deno task build
```

This builds the static site into the `_site` directory.

### Serve the site locally

```bash
deno task serve
```

This starts a local development server. The site will be available at `http://localhost:3000` (or similar).

### Run Lume directly

```bash
deno task lume
```

This is equivalent to the build command, running Lume's CLI.

## Usage

1. Run `deno task serve` to start the development server.
2. Open the editor page in your browser.
3. Select a language from the dropdown.
4. Start typing - grammar errors will be highlighted in real-time.
5. Right-click on highlighted errors to see correction suggestions.
6. Use the "Clear" button to reset.

## Requirements

- [Deno](https://deno.land/)

## API

Uses the [Divvun Grammar API](https://api-giellalt.uit.no/#grammar)
