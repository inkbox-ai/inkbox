import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const workflow = readFileSync(new URL('../workflows/sdk_integration.yml', import.meta.url), 'utf8');
const components = { 'python-sdk': 'Python SDK', 'typescript-sdk': 'TypeScript SDK', cli: 'CLI' };
const title = '📦 SDK integration tests';
const environments = { development: '🛠️ Development', beta: '🧪 Beta', production: '🚀 Production' };

// Execute the actual workflow shell with a local curl replacement: no network or secrets.
function run(job, environment, source, repository = 'example/sdk') {
  const section = workflow.split(/^  (?=[\w-]+:)/m).find(part => part.startsWith(`${job}:`));
  const notification = section.slice(section.indexOf('      - name: Notify Google Chat'));
  const values = {
    'matrix.environment': environment, 'matrix.source': source,
    'github.repository': repository, 'github.server_url': 'https://github.example',
    'github.run_id': '123', 'github.run_attempt': '2', 'secrets.GOOGLE_CHAT_WEBHOOK_URL': 'https://invalid.example/webhook',
  };
  const substitute = value => value.replace(/\$\{\{\s*(.*?)\s*\}\}/g, (_, key) => {
    assert.ok(key in values, `Unexpected expression: ${key}`);
    return values[key];
  });
  const env = { ...process.env };
  for (const match of notification.matchAll(/^          ([A-Z_]+): (.+)$/gm)) {
    env[match[1]] = substitute(match[2]);
  }
  const body = notification.match(/        run: \|\n((?:          .*\n|\n)*)/)[1]
    .replace(/^          /gm, '');
  const intercept = 'curl() { while (( $# )); do if [[ "$1" == "-d" || "$1" == "--data" ]]; then printf "%s" "$2"; return; fi; shift; done; return 1; };\n';
  return spawnSync('bash', ['-e', '-c', intercept + substitute(body)], { env, encoding: 'utf8' });
}

function render(job, environment, source, repository) {
  const result = run(job, environment, source, repository);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

for (const [job, component] of Object.entries(components)) {
  for (const [environment, header] of Object.entries(environments)) {
    for (const source of ['local', 'published']) {
      test(`${job}: ${environment}, ${source}`, () => {
        const payload = render(job, environment, source);
        assert.equal(payload.text, `${header}\n❌ Failed\n${title}\n\nSummary: ${component} integration job failed.\nScope: example/sdk · ${component} · ${source}\nDetails: <https://github.example/example/sdk/actions/runs/123|View run>`);
        assert.equal(payload.thread.threadKey, `ci-example-sdk-123-2-${environment}`);
        assert.deepEqual(render(job, environment, source), payload, 'threading must be deterministic');
      });
    }
  }
  test(`${job}: unknown environment fails instead of posting an unlabeled alert`, () => {
    const result = run(job, 'staging', 'local');
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /Unknown environment: staging/);
  });
  test(`${job}: safely encodes shell and JSON metacharacters`, () => {
    const repository = 'example/quote\'"\\$(printf unsafe)';
    const payload = render(job, 'beta', 'local', repository);
    assert.ok(payload.text.includes(`Scope: ${repository} · ${component} · local`));
    assert.ok(payload.text.includes(`Details: <https://github.example/${repository}/actions/runs/123|View run>`));
  });
}
