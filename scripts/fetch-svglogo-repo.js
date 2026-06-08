const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { root, repoDir, ensureDir, writeJson } = require("./svglogo-common");

const repoUrl = "https://github.com/HeyHuazi/SVGLOGO.git";

function runGit(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function main() {
  ensureDir(path.join(root, "vendor"));
  let action = "pull";
  if (!fs.existsSync(repoDir)) {
    action = "clone";
    runGit(["clone", repoUrl, repoDir], root);
  } else {
    runGit(["pull"], repoDir);
  }

  const commit = runGit(["rev-parse", "HEAD"], repoDir);
  const report = {
    generated_at: new Date().toISOString(),
    repo: "HeyHuazi/SVGLOGO",
    repo_url: repoUrl,
    action,
    vendor_path: "vendor/SVGLOGO",
    commit
  };
  writeJson(path.join(root, "reports", "svglogo-repo-report.json"), report);
  console.log(`SVGLOGO ${action} OK ${commit}`);
}

main();
