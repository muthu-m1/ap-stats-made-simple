# AP Stats, Made Simple

A free AP Statistics study guide written in plain, 5th-grade-level words: all nine units, an interactive stats lab,
step-by-step test walkthroughs, practice questions, a cheat sheet, key terms, and Stat Buddy, an AI tutor.
A static site with no backend, no trackers and no accounts. Same design system as [World Right Now](https://github.com/muthu-m1/world-right-now).

- `index.html`, `assets/` – the site. `assets/board.js` is the hero's Galton board, `assets/lab.js` the four lab experiments,
  `assets/tutor.js` the AI tutor.
- `data/` – the lessons (`units.json`), key terms, test walkthroughs, practice questions and formulas.
- `assets/vendor/anthropic.js` – the official Anthropic TypeScript SDK, bundled for the browser by `npm run sdk`.
- `scripts/validate.mjs` – checks the data (every `[[term]]` link exists, every question has an answer).

## The AI tutor

Stat Buddy calls Claude (`claude-opus-5-5`) straight from the visitor's browser with the visitor's own Claude API key,
which stays in their browser (this visit only, unless they tick "remember"). Without a key it answers from the guide's
key terms and lessons. It streams answers, keeps the conversation append-only, switches explanation level with a
mid-conversation system message, and opts in to server-side refusal fallbacks (`fallbacks: "default"`).

## Preview locally

```
npm install
npm run serve
```

Then open http://localhost:4174.

## Credits

Typefaces: Newsreader and Hanken Grotesk, SIL Open Font License 1.1 (`assets/fonts/`).
AP® is a trademark registered by the College Board, which is not affiliated with, and does not endorse, this site.
