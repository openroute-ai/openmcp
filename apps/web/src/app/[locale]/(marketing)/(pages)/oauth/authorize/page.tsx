import { Suspense } from 'react'
import { OAuthAuthorizeView } from './oauth-authorize-view'

/**
 * `useSearchParams` opts the whole subtree out of static rendering unless it
 * sits behind a Suspense boundary, so the boundary lives here in the server
 * page while the query-string reading stays in the client view.
 */
export default function OAuthAuthorizePage() {
  return (
    <Suspense fallback={null}>
      <OAuthAuthorizeView />
    </Suspense>
  )
}
