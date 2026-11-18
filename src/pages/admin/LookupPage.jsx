import { useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import AdminQuery from '../../components/admin/AdminQuery.jsx'
import AdminResult from '../../components/admin/AdminResult.jsx'
import { decodeCode } from '../../utils/code.js'
import { ensureCatalogue } from '../../store/productStore.js'
import { ensureAsins } from '../../utils/asinStore.js'

/**
 * Lookup page (/admin)
 * ─────────────────────
 * Paste a creator's code → decode → show the order lines.
 */
export default function LookupPage() {
  const { showToast } = useOutletContext()

  const [result, setResult] = useState(null)
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleQuery = async (inputCode) => {
    setLoading(true)
    setError('')

    // decodeCode is a pure function over the in-memory catalogue, so the data
    // has to be there first. Both calls no-op when it already is.
    try {
      await Promise.all([ensureCatalogue(), ensureAsins()])
    } catch {
      setError('Could not load the catalogue — check your connection.')
      setLoading(false)
      return
    }

    // Short delay so the state change reads as a real lookup
    setTimeout(() => {
      const decoded = decodeCode(inputCode)

      if (!decoded.ok) {
        setError(decoded.error)
        setResult(null)
        setLoading(false)
        return
      }

      setResult(decoded)
      setCode(inputCode)
      setLoading(false)
      showToast(
        `Found ${decoded.totalStyles} ${decoded.totalStyles === 1 ? 'style' : 'styles'}`,
        'success',
      )
    }, 300)
  }

  const handleReset = () => {
    setResult(null)
    setCode('')
    setError('')
  }

  return (
    <div className="mx-auto max-w-md">
      <div className="mb-7">
        <h1 className="text-2xl font-semibold tracking-tight text-charcoal">
          {result ? '选款详情' : '查询选品码'}
        </h1>
        <p className="mt-1.5 text-[13px] leading-relaxed text-charcoal-light">
          {result
            ? '核对清单后导出给仓库。'
            : '粘贴红人发来的选品码，查看她具体选了哪些商品。'}
        </p>
      </div>

      {result ? (
        <AdminResult
          result={result}
          code={code}
          onReset={handleReset}
          showToast={showToast}
        />
      ) : (
        <AdminQuery onQuery={handleQuery} loading={loading} error={error} />
      )}
    </div>
  )
}
