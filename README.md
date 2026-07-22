# e2b — run Python in a sandbox, as a Katari tool

A single module, `e2b`, plus its FFI sidecar `src/e2b.ts`: run Python in an
[e2b](https://e2b.dev) sandbox and hand the result back to the model. The sandbox is **owned by the
provider** and shared by every call in its scope — a stateful kernel, so variables, imports, and
files persist across the model's steps.

- `e2b.provider(api_key = ...)` — serves the **environment**: a `session` (a sandbox id + the api key),
  opening ONE sandbox lazily on first use and sharing it for the extent of the continuation, so the
  model's steps build on each other's state.
- `e2b.run_python(code)` — the tool: perform `session` to get the environment, run the Python in that
  sandbox **in the tool's own context**, and return its stdout / value / error text.

Because `run_python` runs the code at the call site (not inside the provider's handler), an execution
failure surfaces **where the call was made** — so an AI tool loop that dispatched `run_python` catches it
and feeds it back to the model, rather than tearing the whole run down.

The low-level externals (`e2b_open`, `e2b_run_in`) live in the sidecar, which keeps the live sandboxes in
a module-level map keyed by session handle and self-heals an expired one. Each returns a result value
(`{ ok, ... }`) rather than throwing, so a sidecar failure becomes a typed error, never a panic.

## Errors

`run_python` raises **`e2b.execution_error`** when the sandbox cannot run your code at the sidecar level
(a dropped connection, an expired sandbox that will not reconnect, a bad key). A Python error in the code
itself is **not** a failure — it comes back as ordinary output text. The provider raises the same
`execution_error` at its use site when the sandbox cannot be opened, so wire a handler for it wherever you
`use e2b.provider(...)` (an AI loop's dispatch already folds the tool's throw back to the model).

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

agent compute(task: string) -> string with io | prelude.throw[e2b.execution_error] {
  use e2b.provider(api_key = env.get_secret(key = "E2B_API_KEY"))
  e2b.run_python(code = "print(2 ** 100)")
}
```

Hand `e2b.run_python` to an AI loop's tool list to let the model run code on its own; the loop feeds any
`execution_error` back to the model as a result it can read and retry.
