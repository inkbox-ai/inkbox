import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import http from "node:http";
import { fileURLToPath } from "node:url";
import test from "node:test";
const cli = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const f = JSON.parse(await readFile(new URL("../../tests/fixtures/slack_policy_memory.json", import.meta.url), "utf8"));
function run(args) {
  return new Promise(resolve => execFile(process.execPath, [cli, ...args], {
    env:{...process.env,NODE_USE_ENV_PROXY:"0"},timeout:15000,
  }, (error,stdout,stderr) => resolve({error,stdout,stderr})));
}
test("Slack policy CLI has seven explicit operations and rejects malformed edits", async () => {
  const requests=[];let reply={};
  const server=http.createServer(async(req,res)=>{
    const chunks=[];for await (const chunk of req) chunks.push(chunk);
    requests.push({method:req.method,url:req.url,body:Buffer.concat(chunks).toString()});
    res.writeHead(200,{"Content-Type":"application/json"});res.end(JSON.stringify(reply));
  });
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  const globals=["--api-key","synthetic-test-key","--base-url",`http://127.0.0.1:${server.address().port}`,"--json"];
  const base="/api/v1/slack/identities/example-agent/contact-rules";
  const invoke=args=>run([...globals,"slack","contact-rule",...args,"--identity","example-agent"]);
  async function check(args,response,method,path,body) {
    reply=response;const result=await invoke(args);assert.equal(result.error,null,result.stderr);
    const req=requests.at(-1);assert.equal(req.method,method);assert.equal(req.url,base+path);
    if(body)assert.deepEqual(JSON.parse(req.body),body);
  }
  try {
    await check(["create","--action","allow","--match-type","workspace","--match-target","TEXAMPLE","--direction","inbound"],f.rule,"POST","",{action:"allow",match_type:"workspace",match_target:"TEXAMPLE",direction:"inbound"});
    await check(["list","--offset","0"],[f.rule],"GET","?offset=0");
    await check(["get",f.rule.id],f.rule,"GET",`/${f.rule.id}`);
    await check(["update",f.rule.id,"--action","block","--apply-to","outbound"],f.rule,"PATCH",`/${f.rule.id}`,{action:"block",apply_to:"outbound"});
    await check(["settings","get"],f.settings,"GET","/settings");
    await check(["settings","update","--inbound-filter-mode","whitelist"],f.settings,"PATCH","/settings",{inbound_filter_mode:"whitelist"});
    await check(["delete",f.rule.id],null,"DELETE",`/${f.rule.id}`);
    assert.equal(requests.length,7);
    for(const args of [["update",f.rule.id],["settings","update"],["list","--offset","-1"],["create","--action","allow","--match-type","email","--match-target","example@example.com"]]) {
      const result=await invoke(args);assert.ok(result.error);
    }
    assert.equal(requests.length,7);
  } finally { await new Promise(resolve=>server.close(resolve)); }
});
