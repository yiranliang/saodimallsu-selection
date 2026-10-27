import { Link } from 'react-router-dom'
import { t } from '../../i18n/admin.js'

/**
 * Catch-all for unknown /admin/* paths.
 * Without it React Router renders nothing at all, which looks like a crash —
 * and the gate would have nothing to wrap. With it, every /#/admin… URL lands
 * on a real screen, still behind the passcode.
 */
export default function AdminNotFound() {
  return (
    <div className="rounded-2xl bg-white px-5 py-10 text-center ring-1 ring-charcoal/[0.07]">
      <p className="text-[13px] font-medium text-charcoal">{t('Page not found')}</p>
      <p className="mt-1.5 text-[11.5px] leading-relaxed text-charcoal-light">
        {t('This admin URL doesn’t exist. It may have been renamed.')}
      </p>
      <Link
        to="/admin"
        className="mt-5 inline-block rounded-full bg-charcoal px-4 py-2 text-[11.5px] font-medium text-cream transition hover:bg-charcoal/85"
      >
        {t('Back to Lookup')}
      </Link>
    </div>
  )
}
