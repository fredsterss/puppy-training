export function pairingAccessKey(hash: string): string | undefined {
  return new URLSearchParams(hash.replace(/^#/, '')).get('sync')?.trim() || undefined
}

export function isStandaloneLaunch(): boolean {
  const iosNavigator = navigator as Navigator & { standalone?: boolean }
  return window.matchMedia('(display-mode: standalone)').matches || iosNavigator.standalone === true
}

export function shouldConsumePairingLink(hash: string, standalone: boolean): boolean {
  return Boolean(pairingAccessKey(hash) && standalone)
}

export function newPairingAccessKey(randomUUID: () => string = () => crypto.randomUUID()): string {
  return `${randomUUID()}${randomUUID()}`.replaceAll('-', '')
}

export function pairingInviteUrl(origin: string, pathname: string, accessKey: string): string {
  const url = new URL(pathname, origin)
  url.hash = new URLSearchParams({ sync: accessKey }).toString()
  return url.toString()
}
