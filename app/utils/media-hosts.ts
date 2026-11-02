/** 阿里云 OSS 默认域名。自定义域名走 MEDIA_HOSTS。 */
const OSS_HOST = /(?:^|\.)(?:oss-[a-z0-9-]+|oss-accelerate(?:-overseas)?)\.aliyuncs\.com$/i

export function isAllowedMediaProtocol(protocol: string, hostname: string) {
  if (protocol === 'https:')
    return true
  const host = hostname.toLowerCase()
  return protocol === 'http:' && (host === 'localhost' || host === '127.0.0.1')
}

export function isAllowedMediaHost(hostname: string, hosts: Iterable<string>) {
  const host = String(hostname || '').trim().toLowerCase()
  if (!host)
    return false
  for (const item of hosts) {
    if (String(item || '').trim().toLowerCase() === host)
      return true
  }
  return OSS_HOST.test(host)
}

export function isAllowedMediaUrl(url: URL, hosts: Iterable<string>) {
  return isAllowedMediaProtocol(url.protocol, url.hostname) && isAllowedMediaHost(url.hostname, hosts)
}
