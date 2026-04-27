import { getAvailableCheckerCombinations } from "./api.ts";

export const url = "/languages.json";

export async function content() {
  const languages = await getAvailableCheckerCombinations();
  return JSON.stringify(languages);
}
