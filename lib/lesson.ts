// The teacher's handout. The AI may only quote these sentences, and code verifies every quote.

export const LESSON_TITLE = "Stoichiometry: grams to grams";

export const LESSON: string[] = [
  "Stoichiometry uses a balanced chemical equation to relate the amounts of substances in a reaction.",
  "Always check that the equation is balanced before you use it.",
  "To change grams into moles, divide the mass by the molar mass.",
  "The coefficients in the balanced equation give the mole ratio, not the mass ratio.",
  "Multiply the moles of the given substance by the mole ratio, with the wanted substance on top and the given substance on the bottom.",
  "To change moles back into grams, multiply by the molar mass of the wanted substance.",
  "Keep your units with every number so you can see them cancel.",
];

export const DEFAULT_PROBLEM = {
  equation: "2H2 + O2 -> 2H2O",
  given: "H2",
  grams: 4.0,
  target: "O2",
};

export function normalize(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[“”"']/g, "")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/[.!?,;:]+$/g, "")
    .trim();
}

export function quoteIsInLesson(quote: string): boolean {
  const q = normalize(quote);
  if (q.split(" ").length < 5) return false;
  return LESSON.some((s) => normalize(s).includes(q));
}
