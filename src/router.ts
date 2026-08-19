export interface Route {
  name: string;
  param: string;
  query: Record<string, string>;
}

export function parseHash(hash = location.hash): Route {
  const raw = hash.replace(/^#\/?/, '');
  const [path, qs = ''] = raw.split('?');
  const parts = path.split('/').filter(Boolean);
  const query: Record<string, string> = {};
  for (const kv of qs.split('&')) {
    if (!kv) continue;
    const [k, v = ''] = kv.split('=');
    query[decodeURIComponent(k)] = decodeURIComponent(v);
  }
  return { name: parts[0] || 'today', param: parts[1] ?? '', query };
}

export function go(hash: string): void {
  location.hash = hash;
}
