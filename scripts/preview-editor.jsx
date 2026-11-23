import { createRoot } from 'react-dom/client'
import ProductEditor from '../src/components/admin/ProductEditor.jsx'
import '../src/index.css'

const noop = () => {}

const product = {
  id: 'p1',
  sku: 'C8P407',
  name: 'Color Block Ruffle Sleeve Cardigan',
  category: 'Cropped Cardigans',
  categories: ['Cropped Cardigans', 'Striped'],
  image: 'https://m.media-amazon.com/images/I/71example.jpg',
  tag: 'Best-seller',
  badgeColor: '#B74C2E',
  hidden: false,
  isTeaser: false,
  isHoliday: false,
  specs: [],
  variants: {},
  asins: { variants: {} },
  soldOutVariants: {},
  saleStart: '',
  saleEnd: '',
  salePrice: '',
  originalPrice: '',
  discountLabel: '',
  isCampaign: false,
}

createRoot(document.getElementById('root')).render(
  <ProductEditor open product={product} isNew={false} onSave={noop} onClose={noop} showToast={noop} />,
)
