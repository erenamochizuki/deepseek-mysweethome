import path from 'node:path';

export const stage = path.resolve(process.env.CABIN_TEST_STAGE || path.join(import.meta.dirname, '../web/dist'));
const integration = path.join(import.meta.dirname, '../integration/web');

export function stageFile(name) {
  const dir = !process.env.CABIN_TEST_STAGE && /^cabin-(bridge|gallery)\.(css|js)$/.test(name) ? integration : stage;
  return path.join(dir, name);
}
