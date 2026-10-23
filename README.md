# AP Stats, Made Simple

A free AP Statistics study guide written in plain, 5th-grade-level words: all five units of the course that starts in
Fall 2026 (with their official topics), how the exam works, an interactive stats lab, step-by-step test walkthroughs,
practice questions, a cheat sheet, key terms, and Stat Buddy, an AI tutor. The course structure follows College Board's
[AP Statistics Course and Exam Description](https://apcentral.collegeboard.org/media/pdf/ap-statistics-course-and-exam-description.pdf)
(effective Fall 2026); the explanations are this site's own.
A static site with no trackers and no accounts; the only server is the free tutor Worker. Same design system as [World Right Now](https://github.com/muthu-m1/world-right-now).

- `index.html`, `assets/` – the site. `assets/board.js` is the hero's Galton board, `assets/lab.js` the four lab experiments,
  `assets/tutor.js` the AI tutor.
- `data/` – the lessons (`units.json`, with each unit's exam weighting and official topic list), key terms, test
  walkthroughs, practice questions and formulas.
- `assets/vendor/anthropic.js` – the official Anthropic TypeScript SDK, bundled for the browser by `npm run sdk`.
- `scripts/validate.mjs` – checks the data (every `[[term]]` link exists, every question has an answer).

## The AI tutor

Stat Buddy answers in one of three ways:

1. **Free shared tutor (the default).** When `assets/config.js` sets `SHARED_TUTOR_URL`, questions go to the Worker in
   `worker/`, which answers with Qwen3 (`@cf/qwen/qwen3-30b-a3b-fp8`) on Cloudflare Workers AI, inside the account's free
   daily allowance. When that allowance runs out, Stat Buddy falls back to study-guide answers until the next day.
2. **The visitor's own Claude API key.** Straight from the browser to Claude (`claude-opus-5-5`) through the Anthropic
   SDK; the key stays in their browser.
3. **No AI.** Answers come from the guide's key terms and lessons.

The instructions live in `assets/tutor-prompt.js`, shared by the site and the Worker. On the Claude path the tutor keeps
the conversation append-only, switches explanation level with a mid-conversation system message, and opts in to
server-side refusal fallbacks (`fallbacks: "default"`).

### The shared tutor Worker

`worker/` is a Cloudflare Worker that only answers requests from the site, rate-limits each visitor (6 questions a
minute) and everyone together (60 a minute per location), checks the conversation, sets the instructions itself so it
can't be used for anything but Stat Buddy, and streams back only the answer (not the model's thinking). On the Workers
Free plan it can't run up a bill: Workers AI simply stops for the day when the free allowance is used.

```
cd worker
npm install
npx wrangler login
npx wrangler deploy
npm test
```

`npm test` checks the Worker in Node with a fake Workers AI; it never calls the real one.

## Preview locally

```
npm install
npm run serve
```

Then open http://localhost:4174.

## Credits

Typefaces: Newsreader and Hanken Grotesk, SIL Open Font License 1.1 (`assets/fonts/`).
AP® is a trademark registered by the College Board, which is not affiliated with, and does not endorse, this site.
