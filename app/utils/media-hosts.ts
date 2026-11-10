export function isAllowedMediaProtocol(protocol: string, hostname: string) {
  if (protocol === 'https:')
    return true
  const host = hostname.toLowerCase()
  return protocol === 'http:' && (host === 'localhost' || host === '127.0.0.1')
}

/** 只放行调用方给出的域名。任意阿里云桶不能从这里过，否则别人的桶可以经本站回传可执行内容。 */
export function isAllowedMediaHost(hostname: string, hosts: Iterable<string>) {
  const host = String(hostname || '').trim().toLowerCase()
  if (!host)
    return false
  for (const item of hosts) {
    if (String(item || '').trim().toLowerCase() === host)
      return true
  }
  return false
}

export function isAllowedMediaUrl(url: URL, hosts: Iterable<string>) {
  return isAllowedMediaProtocol(url.protocol, url.hostname) && isAllowedMediaHost(url.hostname, hosts)
}
