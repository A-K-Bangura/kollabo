import { useState } from 'react'

function App() {
  const [count, setCount] = useState(0)

  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 bg-slate-50 p-6 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">kollabo</h1>
      <p className="text-slate-600 dark:text-slate-400">
        React + Vite + TypeScript + Tailwind CSS. Edit{' '}
        <code className="rounded bg-slate-200 px-1.5 py-0.5 font-mono text-sm dark:bg-slate-800">
          src/App.tsx
        </code>{' '}
        to get started.
      </p>
      <button
        type="button"
        onClick={() => setCount((count) => count + 1)}
        className="rounded-lg bg-indigo-600 px-5 py-2.5 font-medium text-white shadow-sm transition hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 active:scale-95"
      >
        Count is {count}
      </button>
    </main>
  )
}

export default App
