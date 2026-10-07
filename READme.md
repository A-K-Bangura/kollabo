# kollabo

Starter project built with [React](https://react.dev), [Vite](https://vite.dev), [TypeScript](https://www.typescriptlang.org) and [Tailwind CSS](https://tailwindcss.com) (v4, via the `@tailwindcss/vite` plugin).

## Getting started

```bash
npm install
npm run dev
```

## Scripts

| Command           | Description                          |
| ----------------- | ------------------------------------ |
| `npm run dev`     | Start the dev server with HMR        |
| `npm run build`   | Type-check and build for production  |
| `npm run preview` | Preview the production build locally |
| `npm run lint`    | Lint with [Oxlint](https://oxc.rs)   |

## Tailwind

Tailwind is loaded through `@import 'tailwindcss';` in `src/index.css` and the plugin registered in `vite.config.ts`. No `tailwind.config.js` is needed; customize the theme with `@theme` in CSS.
