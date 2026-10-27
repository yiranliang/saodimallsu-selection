/**
 * Drag a colour photo onto the main image
 * ═════════════════════════════════════
 * Ops补图时的老路：前台看链接 → 亚马逊找图 → 回后台复制颜色图 URL → 粘到主图输入框。
 * 现在颜色卡片可以按住拖到左上的主图预览框上松手，URL 自己过去。
 *
 * WHY A CUSTOM MIME TYPE AND NOT `text/plain`
 * ────────────────────────────────────────────
 * `text/plain` is what the browser gives a text field for free, and that is
 * exactly the problem: drop a card on the wrong box — a colour NAME input, say
 * — and the URL is inserted as the colour's name. A photo URL as a colour name
 * saves cleanly and corrupts the variant key. So the drag carries a private
 * type, `application/x-influencer-variant-image`, and only the drop zone that
 * asks for it reacts. Anything else the card is dropped on gets nothing: the
 * browser refuses the drop because no handler accepted it. That is also why
 * "dropped somewhere else does nothing" is a property of the design and not a
 * special case somebody has to remember to write.
 *
 * WHY THE DECISION IS A PURE FUNCTION
 * ────────────────────────────────────
 * The drop handler itself is four lines of DOM. What is worth testing is the
 * decision — empty photo, already the main image, normal apply — and that has
 * to be reachable without a browser, so `planMainImageDrop` lives here and the
 * component only paints the result. Same reason `readVariantDrop` validates:
 * a payload that arrives without a URL is not a bug to crash on, it is a drag
 * from somewhere else.
 *
 * PURE — imported by `scripts/test-variant-drop.mjs` and by the editor.
 */

/** Carries the photo URL being dragged. Private on purpose — see above. */
export const VARIANT_IMAGE_MIME = 'application/x-influencer-variant-image'

/** Carries the colour name, for the toast ("…from Black variant"). */
export const VARIANT_COLOUR_MIME = 'application/x-influencer-variant-colour'

/**
 * Puts the payload on the drag. Called from `dragstart`, where `setData` is
 * allowed — reading it back is only possible in `drop`.
 *
 * @param {DataTransfer} transfer
 * @param {{ url: string, colour?: string }} payload
 */
export function writeVariantDrag(transfer, { url, colour }) {
  transfer.setData(VARIANT_IMAGE_MIME, String(url || ''))
  transfer.setData(VARIANT_COLOUR_MIME, String(colour || ''))
}

/**
 * Is this drag one of ours? `types` is readable during `dragover` (the data
 * itself is not), which is what lets the drop zone light up only for a card
 * and stay inert for a file dragged in from the desktop.
 *
 * `types` is a frozen array in current browsers but was a `DOMStringList`
 * once, so spread before asking.
 */
export function isVariantDrag(types) {
  if (!types) return false
  return [...types].includes(VARIANT_IMAGE_MIME)
}

/**
 * The payload out of a drop, or `null` when it is not ours.
 *
 * `null` rather than an error: a drop can carry anything, and the only
 * correct response to "not a colour photo" is to do nothing.
 *
 * @param {DataTransfer} transfer
 * @returns {{ url: string, colour: string } | null}
 */
export function readVariantDrop(transfer) {
  if (!transfer || typeof transfer.getData !== 'function') return null
  const url = String(transfer.getData(VARIANT_IMAGE_MIME) || '').trim()
  if (!url) return null
  const colour = String(transfer.getData(VARIANT_COLOUR_MIME) || '').trim()
  return { url, colour }
}

/**
 * What a drop should do.
 *
 *  - `apply` — take the photo: the normal case.
 *  - `noop`   — that photo is already the main image. Still worth a toast:
 *               a click that changes nothing reads as a broken button.
 *  - `empty`  — the colour has no photo. Only reachable if a card is dragged
 *               without a URL, which the editor prevents; kept because the
 *               alternative is a silent no-op that looks like a bug.
 *
 * @param {unknown} currentImage  what the main image field holds now
 * @param {{ url?: string, colour?: string }} incoming
 * @returns {{ kind: 'apply' | 'noop' | 'empty', url: string, colour: string }}
 */
export function planMainImageDrop(currentImage, incoming) {
  const url = String(incoming?.url || '').trim()
  const colour = String(incoming?.colour || '').trim()
  if (!url) return { kind: 'empty', url: '', colour }
  if (url === String(currentImage || '').trim()) return { kind: 'noop', url, colour }
  return { kind: 'apply', url, colour }
}
