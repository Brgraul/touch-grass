import { createServer, request as proxyRequest } from 'node:http'

export function startNativeGateway() {
  return createServer((request, response) => {
    const auth = request.url?.startsWith('/auth/v1/')
    const proxy = proxyRequest({ hostname: '127.0.0.1', port: auth ? 9999 : 3001, path: request.url?.replace(auth ? '/auth/v1' : '/rest/v1', ''), method: request.method, headers: request.headers }, (upstream) => { response.writeHead(upstream.statusCode ?? 502, upstream.headers); upstream.pipe(response) })
    proxy.on('error', () => { response.statusCode = 502; response.end('Local test service unavailable') })
    request.pipe(proxy)
  }).listen(54321, '127.0.0.1')
}

if (process.argv[1]?.endsWith('native-gateway.ts')) startNativeGateway()
