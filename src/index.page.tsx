import {
  ClearButton,
  Controls,
  EditorContainer,
  LanguageSelector,
  StatusBar,
} from "./components/index.ts";

export const title = "Divvun Grammar and Spell Checker";
export const description =
  "Advanced grammar and spell checking for Sámi and other languages";
export const layout = "layout.tsx";

export default function GrammarEditor() {
  return (
    <>
      <Controls>
        <LanguageSelector />
        <ClearButton />
      </Controls>
      <EditorContainer />
      <StatusBar />
    </>
  );
}
