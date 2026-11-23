import { createRoot } from 'react-dom/client'
import ProductEditor from '../src/components/admin/ProductEditor.jsx'
import '../src/index.css'

const noop = () => {}

const product = {
  id: 'p1',
  sku: 'M6D749',
  name: 'Vintage Button Down Floral Cardigan',
  category: 'Floral',
  categories: ['Floral', 'Trending'],
  image: 'https://m.media-amazon.com/images/I/71example.jpg',
  tag: '',
  badgeColor: '#B74C2E',
  hidden: false,
  isTeaser: false,
  isHoliday: false,
  specs: [
    { type: 'colour', name: 'Colour', options: ['Black', 'Apricot'] },
    { type: 'size', name: 'Size', options: ['S', 'M', 'L'] },
  ],
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
