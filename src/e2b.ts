// The sidecar half of `e2b.ktr` — a STATEFUL e2b sandbox per session. Sandboxes are kept alive in a
// module-level map (the sidecar is one process per snapshot), keyed by the session handle Katari
// threads through, so variables / imports / files persist across `run_python` calls within a session.
// This is what lets the model build on a prior step's state instead of every call starting fresh.

import { Sandbox } from "@e2b/code-interpreter";
import { katari } from "@katari-lang/port";

// session handle -> the live sandbox. The handle is the id `e2b_open` minted (the first sandbox's id),
// but it is only ever used as a lookup key here — a self-healed sandbox is re-stored under the same key.
const sandboxes = new Map<string, Sandbox>();

// Open a new sandbox and register it under its own id — the handle Katari replays on every later run.
katari.agent<{ api_key: string }>("e2b_open", async ({ api_key }) => {
  const sandbox = await Sandbox.create({ apiKey: api_key });
  sandboxes.set(sandbox.sandboxId, sandbox);
  return sandbox.sandboxId;
});

// Run code in the session's sandbox. A cache miss (the sidecar restarted, or the sandbox timed out)
// reconnects to the live sandbox, or starts a fresh one under the SAME handle so the Katari-side id
// stays valid — a self-healing session that loses state only when the sandbox has actually expired.
katari.agent<{ session: string; code: string; api_key: string }>(
  "e2b_run_in",
  async ({ session, code, api_key }) => {
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
    return output === "" ? "(no output)" : output;
  },
);
