import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import http from "node:http";
import test from "node:test";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const wire = JSON.parse(readFileSync(new URL("../../contracts/computer-templates.json", import.meta.url), "utf8"));
for (const command of ["templates", "shapes"]) test(`computers ${command} reads the catalog without mutating`, async () => {
  const payload = command === "templates" ? wire : JSON.parse(readFileSync(new URL("../../contracts/computer-shapes.json", import.meta.url), "utf8"));
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push([req.method, req.url]);
    res.writeHead(200, {"content-type": "application/json"});
    res.end(JSON.stringify(payload));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const stdout = await new Promise((resolve, reject) => execFile(process.execPath,
      [cli, "--api-key", "synthetic-key", "--base-url", `http://127.0.0.1:${server.address().port}`, "--json", "computers", command],
      {timeout: 15000, env: {...process.env, NODE_USE_ENV_PROXY: "0"}},
      (error, stdout) => error ? reject(error) : resolve(stdout)));
    assert.deepEqual(JSON.parse(stdout), payload);
    assert.deepEqual(requests, [["GET", `/api/v1/computers/${command}`]]);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
