import { useState } from 'react'
import { Search, ArrowLeft } from '../icons.jsx'
import { t, codeErrorZh } from '../../i18n/admin.js'
import { CODE_PREFIX } from '../../utils/code.js'

/**
 * Code lookup form
 * ─────────────────
 * Paste a code, hit search.
 *
 * 输入框的占位符与下面的说明都从 `CODE_PREFIX` 取值：品牌一换，提示里的
 * `sdm-` 自动跟着变。写死的话，第二个品牌上线时运营会被一条错误的
 * 示例带着填不对格式 —— 而 `decodeCode` 只会冷冰冰地回一句前缀不对。
 */
export default function AdminQuery({ onQuery, loading, error }) {
  const [code, setCode] = useState('')

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!code.trim()) return
    onQuery(code.trim())
  }

  return (
    <div className="w-full">
      <form onSubmit={handleSubmit} className="space-y-3">
        <label
          htmlFor="code-input"
          className="block text-[11px] font-medium tracking-wider text-charcoal-light"
        >
          {t('Selection code')}
        </label>

        <div className="relative">
          <input
            id="code-input"
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder={t('Paste the code, e.g. {prefix}-xxxxxx', { prefix: CODE_PREFIX })}
            autoComplete="off"
            spellCheck={false}
            className={`input-field pr-12 font-mono text-[13px] ${
              error ? 'border-red-300 bg-red-50/50' : ''
            }`}
          />
          <div className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-charcoal-light/40">
            <Search className="h-4 w-4" />
          </div>
        </div>

        {/* decodeCode 的错误是英文契约（CLI / 控制台 / 测试都对着它断言），
            这里翻成运营读的那句话，不必改底层。 */}
        {error && (
          <p className="flex items-start gap-1.5 text-[12px] leading-snug text-red-500">
            <span className="mt-1.5 h-1 w-1 flex-shrink-0 rounded-full bg-red-500" />
            {codeErrorZh(error, CODE_PREFIX)}
          </p>
        )}

        <button
          type="submit"
          disabled={loading || !code.trim()}
          className={`flex w-full items-center justify-center gap-2 rounded-full py-3.5 text-[15px] font-medium transition-all duration-200 ${
            loading || !code.trim()
              ? 'cursor-not-allowed bg-charcoal/10 text-charcoal/35'
              : 'bg-charcoal text-cream hover:bg-charcoal/85 active:scale-[0.98]'
          }`}
        >
          {loading ? (
            <>
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-cream/30 border-t-cream" />
              {t('Looking up…')}
            </>
          ) : (
            '查询'
          )}
        </button>
      </form>

      <div className="mt-6 rounded-2xl bg-white/60 p-4">
        <div className="text-[11px] font-medium tracking-wider text-charcoal-light">
          怎么用
        </div>
        <ol className="mt-2 space-y-1.5 text-[12px] leading-relaxed text-charcoal/70">
          <li>1. 红人在前台挑款，点「Generate my code」生成选品码</li>
          <li>2. 她把码发给你（以 {CODE_PREFIX}- 开头）</li>
          <li>3. 粘到上面，点查询</li>
          <li>4. 导出 CSV，或者把清单直接复制给仓库</li>
        </ol>
      </div>

      <a
        href="#/"
        className="mt-6 flex items-center justify-center gap-1.5 text-[12px] text-charcoal-light transition hover:text-charcoal"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        {t('Back to storefront')}
      </a>
    </div>
  )
}
