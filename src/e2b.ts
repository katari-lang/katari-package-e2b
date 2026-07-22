// The sidecar half of `e2b.ktr` — a STATEFUL e2b sandbox per session. Sandboxes are kept alive in a
// module-level map (the sidecar is one process per snapshot), keyed by the session handle Katari
// threads through, so variables / imports / files persist across `run_python` calls within a session.
// This is what lets the model build on a prior step's state instead of every call starting fresh.
//
// Both handlers report failure as a RESULT VALUE, never a JS throw: a throw crosses back as a panic,
// which tears the whole run down at the root, out of reach of the tool loop that dispatched the call.
// Returning `{ ok: false, message }` instead lets the Katari side (`e2b.ktr`) raise a typed
// `execution_error` at the call's own context — where the model's loop can read it and adapt.

import { Sandbox } from "@e2b/code-interpreter";
import { katari } from "@katari-lang/port";

// session handle -> the live sandbox. The handle is the id `e2b_open` minted (the first sandbox's id),
// but it is only ever used as a lookup key here — a self-healed sandbox is re-stored under the same key.
const sandboxes = new Map<string, Sandbox>();

// Open a new sandbox and register it under its own id — the handle Katari replays on every later run.
// A connection-level failure (a bad key, e2b unreachable) comes back as `{ ok: false, message }` so the
// provider's handler can raise a typed `execution_error` rather than let a throw become a run-killing panic.
katari.agent<{ api_key: string }>("e2b_open", async ({ api_key }) => {
  try {
    const sandbox = await Sandbox.create({ apiKey: api_key });
    sandboxes.set(sandbox.sandboxId, sandbox);
    return { ok: true, session: sandbox.sandboxId };
  } catch (error) {
    return { ok: false, message: errorMessage(error) };
  }
});

// Run code in the session's sandbox. A cache miss (the sidecar restarted, or the sandbox timed out)
// reconnects to the live sandbox, or starts a fresh one under the SAME handle so the Katari-side id
// stays valid — a self-healing session that loses state only when the sandbox has actually expired. A
// Python error in the code is NORMAL output (`{ ok: true, output }` with the error text folded in); only
// a sidecar-level failure (a dropped connection, an expired sandbox that will not reconnect) returns
// `{ ok: false, message }`, evicting the poisoned handle so the next call re-heals under it.
katari.agent<{ session: string; code: string; api_key: string }>(
  "e2b_run_in",
  async ({ session, code, api_key }) => {
    try {
      let sandbox = sandboxes.get(session);
      if (sandbox === undefined) {
        try {
          sandbox = await Sandbox.connect(session, { apiKey: api_key });
        } catch {
          sandbox = await Sandbox.create({ apiKey: api_key });
        }
        sandboxes.set(session, sandbox);
      }
      const execution = await sandbox.runCode(code);
      const parts = [
        ...execution.logs.stdout,
        ...(execution.text === undefined ? [] : [execution.text]),
        ...execution.logs.stderr,
      ];
      if (execution.error !== undefined) {
        parts.push(`${execution.error.name}: ${execution.error.value}`);
      }
      const output = parts.join("\n").trim();
      return { ok: true, output: output === "" ? "(no output)" : output };
    } catch (error) {
      // Drop the poisoned sandbox so the next call reconnects / recreates under the same handle.
      sandboxes.delete(session);
      return { ok: false, message: errorMessage(error) };
    }
  },
);

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
