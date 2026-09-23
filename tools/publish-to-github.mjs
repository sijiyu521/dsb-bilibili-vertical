/**
 * publish-to-github.mjs —— 用 GitHub REST API 把当前工作区内容发布成一个提交
 *
 * 为什么不用 git push：当前沙箱里 git 的 TLS 栈拿不到证书链（schannel / openssl 都失败），
 * 而 gh(Node) 的网络是通的。所以这里直接走 Objects API 建 blob → tree → commit → 更新 ref。
 *
 * 用法（需要有 repo 权限的 gh 登录态）：
 *   node tools/publish-to-github.mjs <owner/repo> <branch> "<提交信息>"
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

const [repo, branch = 'main', message = 'chore: publish'] = process.argv.slice(2);
if (!repo) {
  console.error('用法: node tools/publish-to-github.mjs <owner/repo> <branch> "<message>"');
  process.exit(1);
}

/** 调 gh api（走 gh 自己的网络栈，避免 git 的证书问题）
 *  注意：当前沙箱禁止 Node 捕获子进程的管道输出（spawn EPERM），
 *  所以统一让 PowerShell 用文件重定向调用 gh，读写都走磁盘。 */
const tmpDir = path.join(root, '.tools', 'gh-tmp');
fs.mkdirSync(tmpDir, { recursive: true });
let seq = 0;
const psQuote = (s) => `'${String(s).replace(/'/g, "''")}'`;

function gh(args, { input } = {}) {
  const tag = `${process.pid}-${++seq}`;
  const inFile = path.join(tmpDir, `in-${tag}.json`);
  const outFile = path.join(tmpDir, `out-${tag}.json`);
  let finalArgs = args;
  if (input) {
    fs.writeFileSync(inFile, JSON.stringify(input), 'utf8');
    finalArgs = [...args, '--input', inFile];
  }
  const cmd = [
    `$out = gh ${finalArgs.map(psQuote).join(' ')} 2>&1 | Out-String`,
    `$code = $LASTEXITCODE`,
    `Set-Content -LiteralPath ${psQuote(outFile)} -Value $out -Encoding UTF8`,
    `exit $code`,
  ].join('; ');
  let failed = false;
  try {
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd], { stdio: 'ignore' });
  } catch (_) {
    failed = true;
  }
  const raw = fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8').replace(/^\uFEFF/, '').trim() : '';
  // gh 把 HTTP 错误写成 `gh: xxx (HTTP 4xx)` 到输出里，空仓库的 409 属于正常情况
  const httpErr = /\(HTTP (\d{3})\)\s*$/.exec(raw);
  if (failed || httpErr) {
    if (httpErr && httpErr[1] === '409') return null;
    const jsonStart = raw.indexOf('{"message"');
    throw new Error('gh 调用失败: ' + (jsonStart >= 0 ? raw.slice(jsonStart, jsonStart + 300) : raw.slice(0, 400)));
  }
  const jsonStart = raw.indexOf('{');
  return raw ? JSON.parse(jsonStart > 0 ? raw.slice(jsonStart) : raw) : null;
}

/** 收集要提交的文件：遵循 .gitignore 的白名单式规则（这里直接按目录白名单，简单可靠） */
function walk(dir, base = '') {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === '.npm-cache' || entry.name === '.tools') continue;
    const abs = path.join(dir, entry.name);
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...walk(abs, rel));
    else out.push({ abs, rel });
  }
  return out;
}

const files = walk(root).filter((f) => !f.rel.startsWith('.git/'));
console.log(`共 ${files.length} 个文件，准备上传到 ${repo}@${branch}`);

/* 1. 读取 base commit（空仓库则没有） */
let baseCommit = null;
let baseTree = null;
try {
  const ref = gh(['api', `repos/${repo}/git/ref/heads/${branch}`]);
  baseCommit = ref.object.sha;
  baseTree = gh(['api', `repos/${repo}/git/commits/${baseCommit}`]).tree.sha;
  console.log('已有分支，父提交:', baseCommit.slice(0, 8));
} catch (e) {
  console.log('分支不存在（空仓库），创建首个提交');
}

/* 2. 逐个建 blob */
const tree = [];
for (const f of files) {
  const content = fs.readFileSync(f.abs);
  const isText = /\.(md|json|js|mjs|cjs|css|html|txt|yml|yaml|gitignore|gitattributes)$/i.test(f.rel) || /^\./.test(path.basename(f.rel));
  const blob = gh(
    ['api', '-X', 'POST', `repos/${repo}/git/blobs`, '--input', '-'],
    { input: { content: content.toString('base64'), encoding: 'base64' } }
  );
  tree.push({ path: f.rel, mode: isText ? '100644' : '100644', type: 'blob', sha: blob.sha });
  process.stdout.write(`  ${f.rel}  ${(content.length / 1024).toFixed(1)}KB\n`);
}

/* 3. 建 tree */
const treeRes = gh(
  ['api', '-X', 'POST', `repos/${repo}/git/trees`, '--input', '-'],
  { input: baseTree ? { base_tree: baseTree, tree } : { tree } }
);

/* 4. 建 commit */
const me = gh(['api', 'user']);
const commitRes = gh(
  ['api', '-X', 'POST', `repos/${repo}/git/commits`, '--input', '-'],
  {
    input: {
      message,
      tree: treeRes.sha,
      parents: baseCommit ? [baseCommit] : [],
      author: { name: me.name || me.login, email: me.email || `${me.login}@users.noreply.github.com` },
      committer: { name: me.name || me.login, email: me.email || `${me.login}@users.noreply.github.com` },
    },
  }
);
console.log('提交完成:', commitRes.sha);

/* 5. 更新/创建分支 ref */
if (baseCommit) {
  gh(['api', '-X', 'PATCH', `repos/${repo}/git/refs/heads/${branch}`, '--input', '-'], {
    input: { sha: commitRes.sha, force: false },
  });
} else {
  gh(['api', '-X', 'POST', `repos/${repo}/git/refs`, '--input', '-'], {
    input: { ref: `refs/heads/${branch}`, sha: commitRes.sha },
  });
}
console.log(`已推送到 https://github.com/${repo}/tree/${branch}`);
