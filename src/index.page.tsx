import {
  Controls,
  LanguageSelector,
  ClearButton,
  StatusBar,
  EditorContainer,
} from "./components/index.ts";

export const title = "Divvun grammar and spell checker";
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
