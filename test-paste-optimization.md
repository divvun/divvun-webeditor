# Paste Optimization Testing Guide

## What was implemented

The intelligent paste detection system now:

1. **Records cursor position before paste** - Knows exactly where content will be inserted
2. **Calculates affected lines** - Determines which lines contain or are adjacent to the paste
3. **Preserves unchanged lines** - Lines before the paste area are not rechecked
4. **Adjusts error indices** - Errors after the paste are shifted by the length difference
5. **Minimal rechecking** - Only checks affected lines plus one line of context before/after

## How to test

### Test 1: Paste in middle of document

1. Open http://localhost:3000
2. Type some North Sami text with errors:

```
Mun leat studeanta ja háliidan oahpahit sámegiella.
Dál čálán ovtta girjji.
Son lea vel báhči.
```

3. Let it complete grammar checking (see errors highlighted)
4. Position cursor in the middle (e.g., after "ovtta")
5. Paste new content: `vejolašgohpama`
6. Watch console logs - should show:
   - "Intelligent paste check" with cursor positions
   - "Lines to check: X-Y" (only affected lines)
   - "Checking affected line X" (not all lines)

### Test 2: Paste at beginning

1. Start with existing text that has been grammar-checked
2. Position cursor at very beginning
3. Paste new content
4. Should only check the first few lines, not the entire document

### Test 3: Large document efficiency

1. Paste the content from `pluff.txt` into the editor
2. Let it complete full checking (this creates a baseline)
3. Position cursor somewhere in the middle
4. Paste a small amount of text
5. Console should show only 2-3 lines being rechecked instead of 60+ lines

## Console output to watch for

Look for these debug messages:

- `📋 Intelligent paste check:` - Shows paste detection
- `Pre-paste cursor: {index: X, length: Y}` - Original cursor position
- `Post-paste cursor: {index: X, length: Y}` - New cursor position
- `Lines to check: {startLine: X, endLine: Y}` - Which lines need rechecking
- `Checking affected line X...` - Only affected lines being processed
- `Intelligent paste check complete. Checked lines X-Y` - Summary

## Performance improvement

Before: Pasting into a 60-line document would recheck all 60 lines
After: Pasting into a 60-line document only rechecks 2-4 lines (the paste area plus context)

This represents a **95%+ reduction in API calls** for typical paste operations!

## Edge cases handled

- Paste at document beginning (cursor index 0)
- Paste at document end
- Paste that replaces selected text (not just insertion)
- Multi-line pastes that span several lines
- Error index adjustment for content after the paste
- Fallback to full check if intelligent detection fails
