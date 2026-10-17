import { startAll } from './servers';
export default async function globalSetup() {
  const servers = await startAll();
  process.env.A11Y_URLS = JSON.stringify(servers.urls);
  return () => servers.close();
}
