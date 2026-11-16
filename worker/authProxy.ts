/**
 * Lets Firebase's sign-in pages be served from this site's own address, so the Google account chooser can show this
 * domain instead of "<project>.firebaseapp.com". Firebase documents this as the way to use its sign-in on your own domain:
 * /__/auth/* and /__/firebase/* are passed through to the project's own Firebase host.
 */

export const isAuthProxyPath = (pathname: string): boolean => pathname.startsWith('/__/auth/') || pathname.startsWith('/__/firebase/');

/** Where a request for this path goes, or null when the path is not one Firebase serves or the project id is unusable */
export const authProxyTarget = (url: URL, projectId: string | undefined): URL | null => {
  if (!projectId || !/^[a-z0-9-]{4,63}$/.test(projectId) || !isAuthProxyPath(url.pathname)) return null;
  return new URL(`${url.pathname}${url.search}`, `https://${projectId}.firebaseapp.com`);
};

export const proxyAuth = async (request: Request, url: URL, projectId: string | undefined): Promise<Response> => {
  const target = authProxyTarget(url, projectId);
  if (!target) return new Response('Not found', { status: 404 });
  if (request.method !== 'GET' && request.method !== 'HEAD' && request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const headers = new Headers(request.headers);
  headers.delete('host'); headers.delete('cookie');
  return fetch(target.toString(), { method: request.method, headers, body: request.method === 'POST' ? request.body : undefined, redirect: 'manual' });
};
