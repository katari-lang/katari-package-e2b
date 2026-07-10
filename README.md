# e2b — run Python in a sandbox, as a Katari tool

A single module, `e2b`, plus its FFI sidecar `src/e2b.ts`: run Python in an
[e2b](https://e2b.dev) sandbox and hand the result back to the model. The sandbox is **owned by the
provider** and shared by every call in its scope — a stateful kernel, so variables, imports, and
files persist across the model's steps.

- `e2b.run_python(code)` — the tool: execute Python, return its stdout / value / error text.
- `e2b.provider(api_key = ...)` — opens ONE sandbox lazily on first use and shares it for the extent
  of the continuation, so the model's steps build on each other's state.

The low-level externals (`e2b_open`, `e2b_run_in`) are implemented in the sidecar, which keeps the
live sandboxes in a module-level map keyed by session handle and self-heals an expired one.

## Secrets / env

- `E2B_API_KEY` — your e2b API key. Store it in the runtime:
  `katari env set E2B_API_KEY --secret`. It is a `string of private`, passed straight to the sidecar
  and never surfaced elsewhere.

## Sidecar dependencies

`src/e2b.ts` imports `@e2b/code-interpreter` and `@katari-lang/port`. They are declared in
`package.json`; run `pnpm install` (or `npm install`) in this package so `katari apply` can bundle the
sidecar. (A pure-Katari consumer that never applies this package does not need them.)

## Usage

```katari
import e2b

agent compute(task: string) -> string with io {
  use e2b.provider(api_key = env.get_secret(key = "E2B_API_KEY"))
  e2b.run_python(code = "print(2 ** 100)")
}
```

Hand `e2b.run_python` to an AI loop's tool list to let the model run code on its own.
