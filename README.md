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

Stat Buddy talks to Claude (`claude-opus-5-5`) in one of three ways:

1. **Shared tutor (no key needed).** When `assets/config.js` sets `SHARED_TUTOR_URL`, questions go to the Worker in
   `worker/`, which adds the site's own API key (stored as a Cloudflare secret, never in this repository).
2. **The visitor's own key.** Straight from the browser to Anthropic; the key stays in their browser.
3. **No AI.** Answers come from the guide's key terms and lessons.

Its instructions and request settings live in `assets/tutor-prompt.js`, shared by the site and the Worker. It streams
answers, keeps the conversation append-only, switches explanation level with a mid-conversation system message, and
opts in to server-side refusal fallbacks (`fallbacks: "default"`).

### The shared tutor Worker

`worker/` is a Cloudflare Worker that only answers requests from the site, rate-limits each visitor (6 questions a
minute) and everyone together (60 a minute per location), checks the conversation, and builds the Claude request itself,
so it can't be used for anything but Stat Buddy. Give its API key a monthly spend limit in the Claude Console.

```
cd worker
npm install
npx wrangler login
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler deploy
npm test
```

`npm test` runs the Worker locally against a fake Claude API; it never calls the real one.

## Preview locally

```
npm install
npm run serve
```

Then open http://localhost:4174.

## Credits

Typefaces: Newsreader and Hanken Grotesk, SIL Open Font License 1.1 (`assets/fonts/`).
AP® is a trademark registered by the College Board, which is not affiliated with, and does not endorse, this site.
