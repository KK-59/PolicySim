/**
 * A hash router in forty lines, deliberately not react-router.
 *
 * PRD §9 rates "server down at demo time" as High and the stall plan is a laptop on a snapshot.
 * A hash route works from file:// with no install, so the demo survives a dead network and a
 * failed npm install alike. Revisit after the event; this is a hackathon-shaped decision and it
 * is recorded as one in PRODUCT.md.
 */

import { useCallback, useEffect, useSyncExternalStore } from 'react'

export type Route = '/' | '/upload' | '/parameters' | '/worlds'

export const ROUTES: readonly Route[] = ['/', '/upload', '/parameters', '/worlds']

function currentPath(): Route {
  const raw = window.location.hash.replace(/^#/, '') || '/'
  const path = raw.split('?')[0] ?? '/'
  return (ROUTES as readonly string[]).includes(path) ? (path as Route) : '/'
}

function subscribe(onChange: () => void) {
  window.addEventListener('hashchange', onChange)
  return () => window.removeEventListener('hashchange', onChange)
}

export function useRoute(): Route {
  const route = useSyncExternalStore(subscribe, currentPath, () => '/' as Route)

  // A route change is a new page: start it at the top, the way a real navigation would.
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' })
  }, [route])

  return route
}

export function navigate(to: Route) {
  if (currentPath() === to) return
  window.location.hash = to
}

export function useNavigate() {
  return useCallback((to: Route) => navigate(to), [])
}

/** href for an anchor. Real links, so middle-click and copy-link behave. */
export const href = (to: Route) => `#${to}`
