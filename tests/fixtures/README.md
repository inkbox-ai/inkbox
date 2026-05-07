# Cross-language conformance fixtures

These fixtures pin the wire-shape transformations both SDKs must perform
identically. Same input on both sides → same output. If a fixture
diverges between Python and TypeScript, one side is wrong.

* `h1_envelope_reference/` — feed a raw HTTP/1.1 request to the
  in-process h1 parser; verify the `DispatchRequest` it builds has the
  same fields on both SDKs.
* `h2_transcode_reference/` — feed h2 pseudo-headers + body chunks to
  the transcoder; verify the `DispatchRequest` it produces matches.

Each fixture is a JSON file with `input` (wire-shaped) and `expected`
(the parsed `DispatchRequest`-equivalent shape). Both SDKs load the
same JSON and assert.
