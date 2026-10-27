import { useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { Copy, Download, Code, AlertCircle } from '../../components/icons.jsx'
import { t } from '../../i18n/admin.js'
import { copyToClipboard, downloadText } from '../../utils/clipboard.js'
import { decodeCode, CODE_PREFIX } from '../../utils/code.js'
import { ensureCatalogue } from '../../store/productStore.js'
import { ensureAsins } from '../../utils/asinStore.js'

/**
 * Developer page (/admin/developer)
 * ──────────────────────────────────
 * For anyone who needs the selection as data rather than a table:
 * paste a code, get canonical JSON, copy or download it.
 *
 * The same decode function is exposed on `window.SAODIMALLSU.decode(code)` so you can
 * run it from the browser console, and mirrored by `scripts/decode.mjs` for
 * server-side / CLI use.
 */
export default function DeveloperPage() {
  const { showToast } = useOutletContext()
  const [input, setInput] = useState('')
  const [output, setOutput] = useState(null)
  const [error, setError] = useState('')

  const handleDecode = async () => {
    // The decoder reads the in-memory catalogue; make sure it is there.
    try {
      await Promise.all([ensureCatalogue(), ensureAsins()])
    } catch {
      setError('Could not load the catalogue — check your connection.')
      return
    }

    const decoded = decodeCode(input.trim())
    if (!decoded.ok) {
      setError(decoded.error)
      setOutput(null)
      return
    }
    setError('')
    setOutput(decoded)
    showToast('Decoded', 'success')
  }

  const json = output ? JSON.stringify(output, null, 2) : ''

  const handleCopy = async () => {
    const ok = await copyToClipboard(json)
    showToast(ok ? 'JSON 已复制' : '复制失败', ok ? 'success' : 'error')
  }

  const handleDownload = () => {
    const ref = output?.ref || 'guest'
    downloadText(`selection_${ref}.json`, json, 'application/json')
    showToast('JSON 已下载', 'success')
  }

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-7">
        <h1 className="text-2xl font-semibold tracking-tight text-charcoal">
          {t('Developer tools')}
        </h1>
        <p className="mt-1.5 text-[13px] leading-relaxed text-charcoal-light">
          把选品码解成结构化 JSON，直接灌进你自己的系统。
        </p>
      </div>

      {/* Input */}
      <div className="rounded-2xl bg-white p-4">
        <label
          htmlFor="dev-code"
          className="block text-[11px] font-medium tracking-wider text-charcoal-light"
        >
          {t('Selection code')}
        </label>
        <textarea
          id="dev-code"
          value={input}
          onChange={(e) => {
            setInput(e.target.value)
            setError('')
          }}
          rows={3}
          spellCheck={false}
          placeholder={`${CODE_PREFIX}-…`}
          className="mt-2 w-full resize-none rounded-xl bg-cream-dark px-3 py-2.5 font-mono text-[12px] leading-relaxed text-charcoal placeholder:text-charcoal-light/50 focus:outline-none focus:ring-1 focus:ring-accent"
        />

        {error && (
          /* 这里刻意显示 `decodeCode` 的**原文**：开发者工具的作用是排障，
           * `Invalid brand prefix` / `Malformed v7 radix` 这些字符串能直接
           * 对上 README 和 `test-code.mjs` 的断言。运营用的查询页会翻成中文
           * （见 AdminQuery 的 codeErrorZh），那一处需要"我该怎么办"。 */
          <p className="mt-2 flex items-center gap-1.5 text-[12px] text-red-500">
            <AlertCircle className="h-3.5 w-3.5" />
            {error}
          </p>
        )}

        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={handleDecode}
            disabled={!input.trim()}
            className={`flex flex-1 items-center justify-center gap-2 rounded-full py-2.5 text-[13px] font-medium transition ${
              input.trim()
                ? 'bg-charcoal text-cream hover:bg-charcoal/85 active:scale-[0.98]'
                : 'cursor-not-allowed bg-charcoal/10 text-charcoal/35'
            }`}
          >
            <Code className="h-4 w-4" />
            {t('Decode')}
          </button>
          <button
            type="button"
            onClick={() => {
              setInput('')
              setOutput(null)
              setError('')
            }}
            className="rounded-full bg-cream-dark px-4 py-2.5 text-[13px] font-medium text-charcoal/70 transition hover:text-charcoal"
          >
            {t('Clear')}
          </button>
        </div>
      </div>

      {/* Output */}
      {output && (
        <div className="mt-4 animate-fade-in">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-medium tracking-wider text-charcoal-light">
              {t('Decoded JSON')}
            </span>
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={handleCopy}
                className="flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-[11px] font-medium text-charcoal ring-1 ring-charcoal/10 transition hover:ring-charcoal/25"
              >
                <Copy className="h-3 w-3" />
                {t('Copy')}
              </button>
              <button
                type="button"
                onClick={handleDownload}
                className="flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-[11px] font-medium text-charcoal ring-1 ring-charcoal/10 transition hover:ring-charcoal/25"
              >
                <Download className="h-3 w-3" />
                {t('Download')}
              </button>
            </div>
          </div>

          <pre className="no-scrollbar max-h-[420px] overflow-auto rounded-2xl bg-charcoal p-4 font-mono text-[11.5px] leading-relaxed text-cream/90">
            {json}
          </pre>
        </div>
      )}

      {/* Reference */}
      <div className="mt-7 space-y-3">
        <div className="rounded-2xl bg-white/60 p-4">
          <div className="text-[11px] font-medium tracking-wider text-charcoal-light">
            浏览器控制台
          </div>
          <pre className="mt-2 overflow-x-auto rounded-xl bg-charcoal/95 p-3 font-mono text-[11px] leading-relaxed text-cream/90">
{`SAODIMALLSU.decode('${CODE_PREFIX}-xxxxx')
SAODIMALLSU.encode('luna', { p001: 2, p005: 1 }, { p001: { Colour: 'Oatmeal', Size: 'M' } })
SAODIMALLSU.products()`}
          </pre>
        </div>

        <div className="rounded-2xl bg-white/60 p-4">
          <div className="text-[11px] font-medium tracking-wider text-charcoal-light">
            在脚本里调用
          </div>
          <pre className="mt-2 overflow-x-auto rounded-xl bg-charcoal/95 p-3 font-mono text-[11px] leading-relaxed text-cream/90">
{`node scripts/decode.mjs ${CODE_PREFIX}-xxxxx
node scripts/decode.mjs ${CODE_PREFIX}-xxxxx --json > order.json`}
          </pre>
        </div>

        <div className="rounded-2xl bg-white/60 p-4">
          <div className="text-[11px] font-medium tracking-wider text-charcoal-light">
            数据结构（v7）
          </div>
          <p className="mt-2 font-mono text-[11px] leading-relaxed text-charcoal/70">
            7.&#123;ref&#125;.&#123;ids&#125;.&#123;radix&#125;.&#123;specs&#125;.&#123;qty&#125;.&#123;ts&#125;.&#123;fp&#125;
          </p>
          <ul className="mt-2 space-y-1 text-[11.5px] leading-relaxed text-charcoal/70">
            <li>
              <b>ids</b> —— 一串 base62 数字，前面一个字母表示压缩方式：
              <code>r</code> 区间、<code>b</code> 位图、<code>s</code> 连续（重复）、
              <code>t</code> 逐个列举。字母后面那位数字是 id 的补零宽度
              （<code>3</code> 对应 p001）。
            </li>
            <li>
              <b>radix</b> —— 这串码里最大的"颜色×尺码"格数 + 1，按 base62 写
            </li>
            <li>
              <b>specs</b> —— 每一行的规格下标压成一个该进制的整数，再转 base62
              （<code>_</code> 表示全 0）
            </li>
            <li>
              <b>qty</b> —— 全是 1 时写 <code>_</code>，否则写稀疏的
              <code>行:数量</code> 对
            </li>
            <li>
              <b>ts</b> —— 从纪元起的秒数，base62
            </li>
            <li>
              <b>fp</b> —— 4 位规格指纹。解码时对不上，说明颜色/尺码列表被改过，
              后台会给出提示，而不是硬按旧下标去猜
            </li>
          </ul>
          <p className="mt-2 text-[11px] leading-relaxed text-charcoal-light">
            载荷就是一段以 {CODE_PREFIX}- 开头的 base62 文本 —— 没有 base64、没有密钥、
            不联网、不查库。v1–v6 的老码（base64）仍然能解。
          </p>
          <p className="mt-2 text-[11px] leading-relaxed text-charcoal-light">
            前缀是品牌名（当前 {CODE_PREFIX}）：粘贴别家品牌的码会被直接判为
            Invalid brand prefix —— 两个库的货号是各自独立的，硬解出来的清单
            看着正常、实际是错的。历史前缀仍然认，老码不会失效。
          </p>
        </div>
      </div>
    </div>
  )
}
