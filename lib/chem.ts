// Deterministic chemistry: code, not AI, decides the right answer.

export const ATOMIC_MASS: Record<string, number> = {
  H: 1.008, He: 4.0026, Li: 6.94, C: 12.011, N: 14.007, O: 15.999, F: 18.998,
  Na: 22.99, Mg: 24.305, Al: 26.982, Si: 28.085, P: 30.974, S: 32.06, Cl: 35.45,
  K: 39.098, Ca: 40.078, Fe: 55.845, Cu: 63.546, Zn: 65.38, Ag: 107.87, I: 126.9,
};

const SUBSCRIPTS: Record<string, string> = { "₀": "0", "₁": "1", "₂": "2", "₃": "3", "₄": "4", "₅": "5", "₆": "6", "₇": "7", "₈": "8", "₉": "9" };

// "H₂ (g)" -> "H2"
export function cleanFormula(formula: string): string {
  return formula
    .replace(/[₀-₉]/g, (c) => SUBSCRIPTS[c] ?? c)
    .replace(/\((s|l|g|aq)\)/gi, "")
    .replace(/\s+/g, "");
}

export function parseFormula(formula: string): Record<string, number> {
  const s = cleanFormula(formula);
  let i = 0;

  function readNumber(): number {
    let digits = "";
    while (i < s.length && /[0-9]/.test(s[i])) {
      digits += s[i];
      i++;
    }
    return digits ? parseInt(digits, 10) : 1;
  }

  function parseGroup(): Record<string, number> {
    const counts: Record<string, number> = {};
    while (i < s.length) {
      const ch = s[i];
      if (ch === "(") {
        i++;
        const inner = parseGroup();
        if (s[i] !== ")") throw new Error(`Unmatched "(" in ${formula}`);
        i++;
        const n = readNumber();
        for (const [el, c] of Object.entries(inner)) counts[el] = (counts[el] || 0) + c * n;
      } else if (ch === ")") {
        return counts;
      } else if (/[A-Z]/.test(ch)) {
        let el = ch;
        i++;
        while (i < s.length && /[a-z]/.test(s[i])) {
          el += s[i];
          i++;
        }
        if (!(el in ATOMIC_MASS)) throw new Error(`Unknown element "${el}"`);
        counts[el] = (counts[el] || 0) + readNumber();
      } else {
        throw new Error(`Can't read the formula "${formula}"`);
      }
    }
    return counts;
  }

  const result = parseGroup();
  if (i !== s.length || Object.keys(result).length === 0) throw new Error(`Can't read the formula "${formula}"`);
  return result;
}

export function molarMass(formula: string): number {
  return Object.entries(parseFormula(formula)).reduce((sum, [el, n]) => sum + ATOMIC_MASS[el] * n, 0);
}

type Term = { coef: number; formula: string };

export function parseEquation(equation: string): { left: Term[]; right: Term[] } {
  const sides = equation.split(/->|→|=/);
  if (sides.length !== 2) throw new Error("The equation needs one arrow (->)");
  const parseSide = (side: string): Term[] =>
    side.split("+").map((raw) => {
      const m = cleanFormula(raw).match(/^(\d*)([A-Za-z][A-Za-z0-9()]*)$/);
      if (!m) throw new Error(`Can't read "${raw.trim()}"`);
      parseFormula(m[2]);
      return { coef: m[1] ? parseInt(m[1], 10) : 1, formula: m[2] };
    });
  return { left: parseSide(sides[0]), right: parseSide(sides[1]) };
}

export function isBalanced(equation: string): boolean {
  const { left, right } = parseEquation(equation);
  const total = (terms: Term[]) => {
    const t: Record<string, number> = {};
    for (const term of terms)
      for (const [el, n] of Object.entries(parseFormula(term.formula))) t[el] = (t[el] || 0) + n * term.coef;
    return t;
  };
  const a = total(left);
  const b = total(right);
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every((k) => a[k] === b[k]);
}

export type Problem = { equation: string; given: string; grams: number; target: string };

export type Solution = {
  answer: number;
  balanced: boolean;
  steps: string[];
  wrongPaths: { tag: Misconception; value: number }[];
};

export type Misconception =
  | "correct"
  | "flipped_mole_ratio"
  | "mass_ratio"
  | "ignored_mole_ratio"
  | "wrong_molar_mass"
  | "not_balanced"
  | "other_unclear";

export function solveGramsToGrams(p: Problem): Solution {
  const { left, right } = parseEquation(p.equation);
  const all = [...left, ...right];
  const g = all.find((t) => t.formula === cleanFormula(p.given));
  const w = all.find((t) => t.formula === cleanFormula(p.target));
  if (!g) throw new Error(`"${p.given}" is not in the equation`);
  if (!w) throw new Error(`"${p.target}" is not in the equation`);
  if (!(p.grams > 0)) throw new Error("The given mass must be more than 0 g");
  const mg = molarMass(g.formula);
  const mw = molarMass(w.formula);
  const molGiven = p.grams / mg;
  const molWanted = (molGiven * w.coef) / g.coef;
  const answer = molWanted * mw;
  return {
    answer,
    balanced: isBalanced(p.equation),
    steps: [
      `${p.grams} g ${g.formula} ÷ ${mg.toFixed(3)} g/mol = ${molGiven.toFixed(4)} mol ${g.formula}`,
      `× (${w.coef} mol ${w.formula} / ${g.coef} mol ${g.formula}) = ${molWanted.toFixed(4)} mol ${w.formula}`,
      `× ${mw.toFixed(3)} g/mol = ${answer.toFixed(2)} g ${w.formula}`,
    ],
    wrongPaths: [
      { tag: "flipped_mole_ratio", value: ((molGiven * g.coef) / w.coef) * mw },
      { tag: "mass_ratio", value: (p.grams * w.coef) / g.coef },
      { tag: "ignored_mole_ratio", value: molGiven * mw },
    ],
  };
}

export function closeTo(a: number, b: number, tol = 0.03): boolean {
  if (!isFinite(a) || !isFinite(b)) return false;
  return Math.abs(a - b) <= Math.abs(b) * tol;
}

export function detectByRule(student: number | null, sol: Solution): Misconception | null {
  if (student === null) return null;
  if (closeTo(student, sol.answer, 0.02)) return "correct";
  for (const w of sol.wrongPaths) if (Math.abs(w.value - sol.answer) > 1e-9 && closeTo(student, w.value)) return w.tag;
  return null;
}
