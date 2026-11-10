These synthetic wire examples are generated from the public Pydantic models and
workspace error translator in inkbox-ai/servers. The source copy is
`tests/fixtures/hosted-workspace-v1.json`; its contract test checks actual JSON
serialization against the authoritative models. Update both copies together.
The TypeScript, Python, and Rust tests exercise their consuming models/methods.

`schedule-control-v1.json` contains synthetic public response samples derived
from the controller's schedule list and mutation projections. It covers offline
pause/delete, a pending resume, synchronized enabled state, and a legacy receipt
that omits the additive control fields. Python dictionaries and Rust JSON values
preserve these fields; TypeScript exposes optional status fields. Internal
command storage fields are not part of these public samples.
