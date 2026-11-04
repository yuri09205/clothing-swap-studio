import { copyFile, mkdir, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageInfo = JSON.parse(await (await import('node:fs/promises')).readFile(join(projectRoot, 'package.json'), 'utf8'));
const version = packageInfo.version;
const makerDir = join(projectRoot, 'out', 'make', 'squirrel.windows', 'x64');
const releaseDir = resolve(projectRoot, '..', 'RELEASE', version);
await mkdir(releaseDir, { recursive: true });
const files = await readdir(makerDir);
const setupName = files.find((name) => /Setup.*\.exe$/i.test(name) || /setup.*\.exe$/i.test(name));
if (!setupName) throw new Error(`Windows installer not found in ${makerDir}`);
const releaseName = `Clothing-Swap-Studio-Setup-${version}.exe`;
await copyFile(join(makerDir, setupName), join(releaseDir, releaseName));
await writeFile(join(releaseDir, 'README.txt'), [
  `Clothing Swap Studio ${version}`,
  '',
  `설치 파일: ${releaseName}`,
  '설치 후 앱을 실행하고 각 사용자의 OpenAI API 키를 입력하세요.',
  '생성 결과는 내 문서\\Clothing Swap Studio\\02_OUTPUT에 저장됩니다.'
].join('\r\n'), 'utf8');
console.log(join(releaseDir, releaseName));
