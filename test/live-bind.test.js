import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("station entrypoint ignores HOST and binds loopback", { timeout: 10_000 }, async (t) => {
  for (const host of ["0.0.0.0", "invalid host"]) {
    const child = spawn(process.execPath, [fileURLToPath(new URL("../src/live/server.js", import.meta.url))], {
      // No inherited credentials or enabled feeds: this launches an offline test station.
      env: { HOST: host, PORT: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    t.after(() => child.kill("SIGKILL"));
    const exited = once(child, "exit");
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    const output = await new Promise((resolve, reject) => {
      let stdout = "";
      const timer = setTimeout(() => reject(new Error("station did not announce startup")), 3000);
      const onExit = (code) => {
        clearTimeout(timer);
        reject(new Error(`station exited before startup (${code}): ${stderr}`));
      };
      child.once("exit", onExit);
      child.once("error", (error) => { clearTimeout(timer); reject(error); });
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
        if (!stdout.includes("\n")) return;
        clearTimeout(timer);
        child.off("exit", onExit);
        resolve(stdout);
      });
    });
    child.kill("SIGTERM");
    const [code, signal] = await exited;
    assert.equal(code, 0, stderr);
    assert.equal(signal, null);
    assert.match(output, /http:\/\/127\.0\.0\.1:[1-9][0-9]*\//, `HOST=${host}`);
  }
});
