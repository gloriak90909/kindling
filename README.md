# Kindling: No minds left behind

An iPad notes app where students write on their teacher's own slides or worksheets with the Apple Pencil, and an AI tutor helps in the margin. Built at TRIANGULATE 2026 for the NAE Grand Challenge **Advance Personalized Learning**.

## What it does
- **Library:** the teacher's PDFs (slides or worksheets) as notebooks. Two sample decks ship in `public/library/`.
- **Notebook:** write on any page with pen, highlighter and eraser. Notes are saved on the device.
- **Check my work:** Claude reads the student's handwriting and the problem on the page, then writes a hint in the margin.
- **Ask:** the student asks a question out loud (browser speech recognition) and hears the answer read back.
- **Supports for everyone:** read aloud, simpler words, Español.

## The AI reads, code decides
Claude (`claude-sonnet-5-5`, with `claude-haiku-5-5` as fallback) returns structured JSON. Our code then:
- computes the real stoichiometry answer from a periodic table (`lib/chem.ts`) and checks the equation balances by counting atoms;
- detects classic mistakes (flipped mole ratio, mass ratio, skipped ratio) by rule;
- verifies every quoted sentence appears word for word in the teacher's PDF, or blocks the hint;
- blocks hints that give away the answer, and checks reading level or Spanish.

## Live vs. not built yet
- **Live:** PDF notebook, handwriting reading, Check my work, voice Ask, all code checks.
- **Not built yet:** teacher dashboard, live sync between devices, accounts. Students are fictional codenames.

## Run it
1. `npm install`
2. Create `.env.local` with `ANTHROPIC_API_KEY=...` (never commit it)
3. `npm run dev` and open http://localhost:3000

On Vercel, add `ANTHROPIC_API_KEY` under Project → Settings → Environment Variables.
