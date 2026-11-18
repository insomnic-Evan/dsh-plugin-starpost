/** Temporary official IP transports. Identity namespaces and custom servers stay unchanged. */
export const STARPOST_IP = 'https://8.148.13.225';
export const HUB_IP = 'https://8.148.13.225:8443';
export const HUB_ISSUER = 'https://ffahub.net';
export function starpostIdentityOrigin(value: string): string {
  const origin = new URL(value).origin;
  return origin === STARPOST_IP ? 'https://starpost.com.cn' : origin;
}
export function hubIdentityOrigin(value: string): string {
  const origin = new URL(value).origin;
  return origin === HUB_IP ? HUB_ISSUER : origin;
}
export function officialTransport(value: string | URL): URL {
  const url = new URL(String(value));
  if (url.username || url.password) return url;
  if (url.origin === 'https://starpost.com.cn') url.hostname = '8.148.13.225';
  else if (url.origin === HUB_ISSUER) { url.hostname = '8.148.13.225'; url.port = '8443'; }
  return url;
}
