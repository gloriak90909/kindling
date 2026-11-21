// Simple, explainable checks on the AI's wording.

function syllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 0;
  const groups = w.replace(/e$/, "").match(/[aeiouy]+/g);
  return Math.max(1, groups ? groups.length : 1);
}

// Flesch-Kincaid grade level (English).
export function readingGrade(text: string): number {
  const sentences = Math.max(1, (text.match(/[.!?]+/g) || []).length);
  const words = text.split(/\s+/).filter((w) => /[a-z]/i.test(w));
  if (words.length === 0) return 0;
  const syl = words.reduce((s, w) => s + syllables(w), 0);
  return 0.39 * (words.length / sentences) + 11.8 * (syl / words.length) - 15.59;
}

const ES = ["el", "la", "los", "las", "de", "que", "y", "en", "un", "una", "es", "por", "para", "con", "del", "se", "lo", "tu", "cuántos", "primero"];
const EN = ["the", "and", "of", "to", "is", "in", "that", "it", "for", "with", "you", "your", "this", "first", "how", "many"];

export function looksSpanish(text: string): boolean {
  const words = text.toLowerCase().split(/[^a-záéíóúñü]+/).filter(Boolean);
  const es = words.filter((w) => ES.includes(w)).length;
  const en = words.filter((w) => EN.includes(w)).length;
  return es > 0 && es >= en * 1.5;
}

export function givesAwayAnswer(hint: string, answer: number): boolean {
  const forms = [answer.toFixed(1), answer.toFixed(2)];
  const nums = hint.match(/\d+(?:[.,]\d+)?/g) || [];
  return nums.some((n) => forms.includes(n.replace(",", ".")));
}
