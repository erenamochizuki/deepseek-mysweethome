// tools/lib/girl-asset.mjs — 自带的蓝色大肥鱼模型（web/assets/girl/fatfish-1.2.zip）。它是第三方模型，按约定不进仓库（.gitignore），
// 刚克隆的仓库里没有。要用它的测试在文件开头调 requireGirlZip()：文件在就照常跑；不在就打印一行 SKIP、正常退出（不算失败）。
// 想跑这些测试：把模型 zip 放到 web/assets/girl/fatfish-1.2.zip。
import fs from 'node:fs';
import path from 'node:path';
import { WEB_DIR } from './v3-node.mjs';

export const GIRL_ZIP = path.join(WEB_DIR, 'assets', 'girl', 'fatfish-1.2.zip');
export const hasGirlZip = () => fs.existsSync(GIRL_ZIP);
export function requireGirlZip(name) {
  if (hasGirlZip()) return true;
  console.log(`SKIP ${name}：web/assets/girl/fatfish-1.2.zip 不在（第三方模型不进仓库；放进去再跑这个测试）`);
  process.exit(0);
}
