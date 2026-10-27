import { lazy, Suspense } from 'react'
import { Routes, Route } from 'react-router-dom'
import SelectionPage from './pages/SelectionPage.jsx'
import { AdminGate } from './components/admin/AccessGate.jsx'
import { brandConfig } from './data/products.js'

/**
 * Routes
 *   /                    creator selection page
 *   /admin               code lookup
 *   /admin/products      product library editor
 *   /admin/developer     decode codes to JSON
 *
 * Nothing in the storefront links to /admin — it's an unlisted route.
 * HashRouter keeps deep links working on any static host without rewrites.
 *
 * WHY THE ADMIN HALF IS SPLIT OUT
 * The storefront is what a creator opens, on a phone, often on a bad connection.
 * Shipping every admin screen inside that bundle meant she downloaded
 * ProductsPage (1,600 lines), the product editor and dnd-kit before seeing a
 * single card. Measured under Slow 4G those bytes were ~40 kB gzip — about a
 * second of her life, every visit, for screens she will never open.
 *
 * `lazy` moves them into a chunk that only loads when an admin actually signs
 * in. The gate stays eager: it is tiny, and keeping it outside the Suspense
 * boundary means a signed-out visitor sees the login form immediately instead
 * of a spinner that then tells her she is not allowed in.
 *
 * Every /admin/* route sits behind <AdminGate>. The gate is attached to the
 * parent route, so nested pages inherit it — a new admin tab added under
 * /admin is protected automatically, no extra wiring.
 */
const AdminLayout = lazy(() => import('./pages/admin/AdminLayout.jsx'))
const LookupPage = lazy(() => import('./pages/admin/LookupPage.jsx'))
const ProductsPage = lazy(() => import('./pages/admin/ProductsPage.jsx'))
const DeveloperPage = lazy(() => import('./pages/admin/DeveloperPage.jsx'))
const AdminNotFound = lazy(() => import('./pages/admin/AdminNotFound.jsx'))

/** Chunk loading placeholder — same CSS ring as the storefront skeleton */
function RouteFallback() {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3">
      <div className="relative flex h-12 w-12 items-center justify-center">
        <span className="brand-spinner absolute inset-0" aria-hidden="true" />
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-[11px] font-bold text-white">
          {brandConfig.logoText}
        </div>
      </div>
      <p className="text-[11.5px] tracking-[0.08em] text-charcoal-light">Loading…</p>
    </div>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<SelectionPage />} />
      <Route
        path="/admin"
        element={
          <AdminGate>
            <Suspense fallback={<RouteFallback />}>
              <AdminLayout />
            </Suspense>
          </AdminGate>
        }
      >
        <Route
          index
          element={
            <Suspense fallback={<RouteFallback />}>
              <LookupPage />
            </Suspense>
          }
        />
        <Route
          path="products"
          element={
            <Suspense fallback={<RouteFallback />}>
              <ProductsPage />
            </Suspense>
          }
        />
        <Route
          path="developer"
          element={
            <Suspense fallback={<RouteFallback />}>
              <DeveloperPage />
            </Suspense>
          }
        />
        {/* Any other /admin… URL still lands inside the gate, never blank */}
        <Route
          path="*"
          element={
            <Suspense fallback={<RouteFallback />}>
              <AdminNotFound />
            </Suspense>
          }
        />
      </Route>
    </Routes>
  )
}
