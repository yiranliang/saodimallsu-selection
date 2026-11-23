import { createRoot } from 'react-dom/client'
import { MemoryRouter, Outlet, Route, Routes } from 'react-router-dom'
import ProductsPage from '../src/pages/admin/ProductsPage.jsx'
import '../src/index.css'

const showToast = () => {}

function Layout() {
  return (
    <div className="min-h-screen bg-cream p-6">
      <Outlet context={{ showToast }} />
    </div>
  )
}

createRoot(document.getElementById('root')).render(
  <MemoryRouter initialEntries={['/admin/products']}>
    <Routes>
      <Route element={<Layout />}>
        <Route path="/admin/products" element={<ProductsPage />} />
      </Route>
    </Routes>
  </MemoryRouter>,
)
