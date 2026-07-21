import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), 'utf8');

function walkTs(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walkTs(full);
    return entry.isFile() && entry.name.endsWith('.ts') ? [full] : [];
  });
}

function githubSlug(heading: string): string {
  return heading
    .replace(/<[^>]+>/g, '')
    .replace(/[`*_~]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}\s-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

function headingSlugs(markdown: string): Set<string> {
  const seen = new Map<string, number>();
  const slugs = new Set<string>();
  for (const match of markdown.matchAll(/^#{1,6}\s+(.+)$/gm)) {
    const base = githubSlug(match[1]!);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    slugs.add(count === 0 ? base : `${base}-${count}`);
  }
  return slugs;
}

function section(markdown: string, heading: RegExp): string {
  const match = heading.exec(markdown);
  assert.ok(match, `missing section ${heading}`);
  const start = match.index + match[0].length;
  const rest = markdown.slice(start);
  const end = rest.search(/^#{2,3}\s+/m);
  return end === -1 ? rest : rest.slice(0, end);
}

test('release version is 1.13.0 in package, lockfile, MCP server, and MCP test', () => {
  const pkg = JSON.parse(read('package.json'));
  const lock = JSON.parse(read('package-lock.json'));
  assert.equal(pkg.version, '1.13.0');
  assert.equal(lock.version, '1.13.0');
  assert.equal(lock.packages[''].version, '1.13.0');
  assert.match(read('src/mcp-core.ts'), /SERVER_INFO = \{ name: 'binance-smart-money', version: '1\.13\.0' \}/);
  assert.match(read('test/mcp-core.test.ts'), /serverInfo version 1\.13\.0/);
});

test('.env.example covers runtime variables and both deployment-doc env tables', () => {
  const envPath = path.join(ROOT, '.env.example');
  assert.ok(fs.existsSync(envPath), '.env.example must exist');
  const example = read('.env.example');
  const exampleVars = new Set([...example.matchAll(/^#?\s*([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1]!));

  const required = [
    'SMART_MONEY_DB_PATH', 'SMART_MONEY_CARD_LANG',
    'SMART_MONEY_WATCHLIST', 'SMART_MONEY_WATCHLIST_FILE', 'SMART_MONEY_INTERVAL_MIN',
    'SMART_MONEY_DASHBOARD_HOST', 'SMART_MONEY_DASHBOARD_PORT', 'SMART_MONEY_DASHBOARD_CORS',
    'SMART_MONEY_ALERT_TG_TOKEN', 'SMART_MONEY_ALERT_TG_CHAT_ID',
    'SMART_MONEY_ALERT_WINDOW_MIN', 'SMART_MONEY_ALERT_QTY_PCT',
  ];
  for (const name of required) assert.ok(exampleVars.has(name), `.env.example missing ${name}`);

  const runtime = walkTs(path.join(ROOT, 'src'))
    .map((file) => fs.readFileSync(file, 'utf8'))
    .join('\n');
  const runtimeVars = new Set([...runtime.matchAll(/process\.env\.([A-Z][A-Z0-9_]+)/g)].map((m) => m[1]!));
  for (const name of runtimeVars) assert.ok(exampleVars.has(name), `.env.example missing runtime variable ${name}`);

  const envDocs: Array<[string, RegExp]> = [
    ['docs/DEPLOYMENT.md', /^## Env vars\s*$/m],
    ['docs/DEPLOYMENT.zh-CN.md', /^## 环境变量\s*$/m],
  ];
  for (const [file, heading] of envDocs) {
    const doc = read(file);
    const envSection = section(doc, heading);
    for (const name of exampleVars) {
      assert.match(envSection, new RegExp(`\\b${name}\\b`), `${file} env table missing ${name}`);
    }
    const expectedDefaults: Record<string, string> = {
      SMART_MONEY_WATCHLIST_FILE: 'watchlist.json', SMART_MONEY_INTERVAL_MIN: '0',
      SMART_MONEY_POOL_MAX: '0', SMART_MONEY_SHARD_INDEX: '0', SMART_MONEY_SHARD_TOTAL: '1',
      TOP_TRADER_POOL_MAX: '0', TOP_TRADER_SHARD_INDEX: '0', TOP_TRADER_SHARD_TOTAL: '1',
      OI_POOL_MAX: '0', OI_SHARD_INDEX: '0', OI_SHARD_TOTAL: '1',
      SMART_MONEY_DASHBOARD_HOST: '127.0.0.1', SMART_MONEY_DASHBOARD_PORT: '3001',
      PORT: '3001', SMART_MONEY_CARD_LANG: 'zh', SMART_MONEY_ALERT_WINDOW_MIN: '30',
      SMART_MONEY_ALERT_QTY_PCT: '5',
    };
    for (const [name, value] of Object.entries(expectedDefaults)) {
      assert.ok(
        envSection.includes(`| \`${name}\` | \`${value}\` |`),
        `${file} has the wrong documented default for ${name}`,
      );
    }
  }
});

test('release notes and CLI examples describe 1.13.0 behavior', () => {
  assert.match(read('CHANGELOG.md'), /^## 1\.13\.0$/m);
  for (const file of ['docs/DEPLOYMENT.md', 'docs/DEPLOYMENT.zh-CN.md', 'GUIDE.zh-CN.md']) {
    const doc = read(file);
    assert.match(doc, /npm run change -- [A-Z]+ \d+/m, `${file} missing separator-safe change example`);
    assert.match(doc, /npm run trend -- [A-Z]+ \d+/m, `${file} missing separator-safe trend example`);
  }
});

test('MCP install command is canonical everywhere', () => {
  const canonical = 'claude mcp add smartmoney -- npx -y binance-smart-money-oi-monitor@latest';
  const files = ['README.md', 'README.zh-CN.md', 'GUIDE.zh-CN.md', 'src/scripts/mcp-server.ts'];
  for (const file of files) {
    const found = read(file).split('\n').filter((line) => line.includes('claude mcp add'));
    assert.ok(found.length > 0, `${file} missing MCP install command`);
    for (const raw of found) {
      const line = raw.replace(/[`'"\\]/g, '').trim();
      assert.ok(line.includes(canonical), `non-canonical MCP command in ${file}: ${line}`);
    }
  }
});

for (const file of ['README.md', 'README.zh-CN.md', 'docs/DEPLOYMENT.md', 'docs/DEPLOYMENT.zh-CN.md']) {
  test(`${file} has unique H2 headings and valid local anchors`, () => {
    const doc = read(file);
    const h2 = [...doc.matchAll(/^##\s+(.+)$/gm)].map((m) => githubSlug(m[1]!));
    assert.equal(new Set(h2).size, h2.length, `${file} contains duplicate H2 headings`);

    const slugs = headingSlugs(doc);
    const anchors = [...doc.matchAll(/\[[^\]]+\]\(#([^)]+)\)/g)].map((m) => decodeURIComponent(m[1]!));
    for (const anchor of anchors) assert.ok(slugs.has(anchor), `${file} has broken local anchor #${anchor}`);
  });
}
