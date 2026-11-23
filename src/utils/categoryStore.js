/**
 * Category store
 * ══════════════
 * The ordered list behind the storefront rail and the editor's suggestions.
 *
 * 两条数据库已经定好的规则，这里只是按正确顺序驱动它们：
 *
 *   · products.category 是指向 categories.name 的外键，所以商品不可能指向一个
 *     不存在的分类
 *   · 纯改名就是一条 `UPDATE categories SET name = …`：外键带 `ON UPDATE
 *     CASCADE`，商品自己跟过去，`sort_order` 留在原来那一行上
 *   · 改名撞上已有分类才是特例：级联做不到"并到另一行"，所以先把商品搬过去、
 *     再删旧行（见 utils/categoryRename.js 的判定）
 *
 * The list is a suggestion list, not a constraint: a hand-typed category is
 * auto-created by the `ensure_category` trigger and shows up here on the next
 * fetch.
 */

import { categories as DEFAULT_CATEGORIES } from '../data/products.js'
import { isConfigured, requireClient } from '../lib/supabase.js'
import { loadProducts, setProductsCategory } from '../store/productStore.js'
import { planCategoryRename } from './categoryRename.js'

let status = isConfigured ? 'idle' : 'ready'
let cache = isConfigured ? [] : [...DEFAULT_CATEGORIES]
let inflight = null

/**
 * name → sort_order, kept beside `cache` for the same reason the product store
 * keeps `orderById`: the number is what the database orders by, and reordering
 * means swapping two of them. Without this map `nextSortOrder()` could only
 * guess from the array length — which put a newly added category *before*
 * Bras(8) and Leggings(9) instead of at the end.
 */
const sortOrderByName = new Map()

/**
 * name → 一级分组（20-category-group.sql 的 `group_name`）。
 *
 * 空字符串 = 未分组；前台会退回关键词匹配（见 utils/shopGroups.js），所以旧库
 * 没跑迁移、或者运营还没配完，菜单也不会缺分类。
 */
const groupByName = new Map()

/**
 * `categories.group_name`（20-category-group.sql）在不在。
 * 不在时设置里要明说"先跑迁移"，否则下拉改了也存不进去。
 */
let groupColumnStatus = 'unknown'

/** 一级分组本身（顺序即展示顺序）。表缺失时退回内置五个。 */
let groupList = ['Tops', 'Bottoms', 'Sets & Dresses', 'Accessories', 'Shoes']
const groupOrderByName = new Map(groupList.map((name, index) => [name, index]))

export function getCategoryGroupStatus() {
  return groupColumnStatus
}

/** 分组选项：后台下拉和前台分组共用一份。 */
export const CATEGORY_GROUP_TITLES = ['Tops', 'Bottoms', 'Sets & Dresses', 'Accessories', 'Shoes']

const listeners = new Set()

function notify() {
  listeners.forEach((fn) => fn())
}

function normalize(list) {
  if (!Array.isArray(list)) return []
  const out = []
  const seen = new Set()
  for (const raw of list) {
    const name = String(raw ?? '').trim()
    if (!name) continue
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(name)
  }
  return out
}

/* ── reads ───────────────────────────────────────────────────────────────── */

/** name → 一级分组。没有映射的分类不在里面（前台按关键词兜底）。 */
/** 一级分组列表（顺序即前台菜单顺序）。 */
export function getCategoryGroupList() {
  return groupList
}

/** 新增一个一级分组（排在最后）。返回 false 表示重名或空。 */
export async function addCategoryGroup(name) {
  const value = String(name ?? '').trim()
  if (!value) return false
  if (groupList.some((item) => item.toLowerCase() === value.toLowerCase())) return false

  const max = groupList.length ? Math.max(...groupList.map((item) => groupOrderByName.get(item) ?? 0)) : -1
  const { error } = await requireClient()
    .from('category_groups')
    .insert({ name: value, sort_order: max + 1 })
  if (error) throw new Error(error.message)

  groupOrderByName.set(value, max + 1)
  groupList = [...groupList, value]
  notify()
  return true
}

/** 删除一个一级分组。用它归类的分类会被置为"未分组"。 */
/** 给分组改名：先建新行、把分类指过去、再删旧行（group_name 是文本，不是外键）。 */
export async function renameCategoryGroup(from, to) {
  const oldName = String(from ?? '').trim()
  const newName = String(to ?? '').trim()
  if (!oldName || !newName || oldName === newName) return false
  if (groupList.some((item) => item.toLowerCase() === newName.toLowerCase())) return false

  const client = requireClient()
  const order = groupOrderByName.get(oldName) ?? groupList.length

  const { error: insertError } = await client
    .from('category_groups')
    .insert({ name: newName, sort_order: order })
  if (insertError) throw new Error(insertError.message)

  const { error: moveError } = await client
    .from('categories')
    .update({ group_name: newName })
    .eq('group_name', oldName)
  if (moveError) throw new Error(moveError.message)

  await client.from('category_groups').delete().eq('name', oldName)

  groupList = groupList.map((item) => (item === oldName ? newName : item))
  groupOrderByName.delete(oldName)
  groupOrderByName.set(newName, order)
  for (const [category, group] of [...groupByName.entries()]) {
    if (group === oldName) groupByName.set(category, newName)
  }
  notify()
  return true
}

export async function removeCategoryGroup(name) {
  const value = String(name ?? '').trim()
  if (!value) return

  const client = requireClient()
  await client.from('categories').update({ group_name: '' }).eq('group_name', value)
  const { error } = await client.from('category_groups').delete().eq('name', value)
  if (error) throw new Error(error.message)

  groupOrderByName.delete(value)
  groupList = groupList.filter((item) => item !== value)
  for (const [category, group] of [...groupByName.entries()]) {
    if (group === value) groupByName.delete(category)
  }
  notify()
}

/** 上移 / 下移一个一级分组（direction: -1 上，1 下）。 */
export async function moveCategoryGroup(name, direction) {
  const index = groupList.indexOf(String(name))
  if (index < 0) return
  const target = index + direction
  if (target < 0 || target >= groupList.length) return

  const reordered = [...groupList]
  ;[reordered[index], reordered[target]] = [reordered[target], reordered[index]]

  const client = requireClient()
  await Promise.all(
    reordered.map((item, order) =>
      client.from('category_groups').update({ sort_order: order }).eq('name', item),
    ),
  )

  groupList = reordered
  groupOrderByName.clear()
  reordered.forEach((item, order) => groupOrderByName.set(item, order))
  notify()
}

/**
 * 一次性保存菜单布局（草稿模式用）。
 *
 * @param {{ title: string, categories: string[] }[]} layout
 *   数组顺序 = 一级分组的展示顺序；每组里的 categories 顺序 = 二级展示顺序。
 *   `title` 为空的组表示"未分组"，其分类 group_name 写成空串。
 */
export async function saveMenuLayout(layout) {
  const groups = Array.isArray(layout) ? layout : []
  const client = requireClient()

  let categoryOrder = 0
  const writes = []

  groups.forEach((group, groupIndex) => {
    const title = String(group?.title ?? '').trim()

    if (title) {
      writes.push(
        client.from('category_groups').update({ sort_order: groupIndex }).eq('name', title),
      )
    }

    for (const name of group?.categories || []) {
      const category = String(name ?? '').trim()
      if (!category) continue
      writes.push(
        client
          .from('categories')
          .update({ group_name: title, sort_order: categoryOrder })
          .eq('name', category),
      )
      categoryOrder += 1
    }
  })

  const results = await Promise.all(writes)
  const failed = results.find((result) => result?.error)
  if (failed) throw new Error(failed.error.message)

  await loadCategories({ silent: true })
}

export function getCategoryGroups() {
  return Object.fromEntries(groupByName)
}

/** 改一个分类的一级分组。空字符串 = 未分组。 */
export async function setCategoryGroup(name, group) {
  const key = String(name ?? '').trim()
  if (!key) return
  const value = String(group ?? '').trim()

  const { error } = await requireClient()
    .from('categories')
    .update({ group_name: value })
    .eq('name', key)

  if (error) throw new Error(error.message)

  if (value) groupByName.set(key, value)
  else groupByName.delete(key)
  notify()
}

export function getCategories() {
  return cache
}

export function subscribeCategories(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/* ── loading ─────────────────────────────────────────────────────────────── */

/** 读一级分组表；表不存在时保留内置五个，不抛错。 */
async function loadCategoryGroups() {
  try {
    const { data, error } = await requireClient()
      .from('category_groups')
      .select('name, sort_order')
      .order('sort_order', { ascending: true })
    if (error) return
    const names = (data || [])
      .map((row) => String(row.name ?? '').trim())
      .filter(Boolean)
    if (!names.length) return
    groupList = names
    groupOrderByName.clear()
    for (const row of data || []) {
      const name = String(row.name ?? '').trim()
      if (name) groupOrderByName.set(name, row.sort_order ?? 0)
    }
  } catch {
    /* 表还没建：用内置列表 */
  }
}

export async function loadCategories({ silent = false } = {}) {
  if (!isConfigured) return cache
  if (inflight) return inflight

  if (!silent) {
    status = 'loading'
    notify()
  }

  inflight = (async () => {
    try {
      await loadCategoryGroups()
      let { data, error } = await requireClient()
        .from('categories')
        .select('name, sort_order, group_name')
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true })

      /* 迁移没跑：退回两列的查询，功能照常，"分组"下拉会被 UI 标出来。 */
      if (error && /group_name/i.test(error.message)) {
        groupColumnStatus = 'missing'
        const retry = await requireClient()
          .from('categories')
          .select('name, sort_order')
          .order('sort_order', { ascending: true })
          .order('name', { ascending: true })
        data = retry.data
        error = retry.error
      } else if (!error) {
        groupColumnStatus = 'ok'
      }

      if (error) throw new Error(error.message)

      sortOrderByName.clear()
      groupByName.clear()
      for (const row of data || []) {
        const name = String(row.name ?? '').trim()
        if (!name) continue
        sortOrderByName.set(name, row.sort_order ?? 0)
        const group = String(row.group_name ?? '').trim()
        if (group) groupByName.set(name, group)
      }

      cache = normalize((data || []).map((row) => row.name))
      status = 'ready'
    } catch (error) {
      status = 'error'
      throw error
    } finally {
      inflight = null
      notify()
    }
  })()

  return inflight
}

/* ── writes ──────────────────────────────────────────────────────────────── */

function nextSortOrder() {
  let max = -1
  for (const value of sortOrderByName.values()) max = Math.max(max, value)
  return max + 1
}

/** Add one category. Returns false when it is blank or already there. */
export async function addCategory(name) {
  const clean = String(name ?? '').trim()
  if (!clean) return false
  if (cache.some((existing) => existing.toLowerCase() === clean.toLowerCase())) return false

  const sortOrder = nextSortOrder()
  const { error } = await requireClient()
    .from('categories')
    .insert({ name: clean, sort_order: sortOrder })

  if (error) throw new Error(error.message)

  cache = [...cache, clean]
  sortOrderByName.set(clean, sortOrder)
  notify()
  return true
}

/**
 * Swap a category with its neighbour — two updates, no reindex, exactly like
 * the product list. Categories are a handful of rows, so a full renumber would
 * also be fine; the swap is simply the same pattern the rest of the console
 * already uses, and it leaves the numbers alone.
 *
 * The storefront rail reads `getCategories()`, so it follows on the next render
 * (and other tabs on the next realtime refetch of the `categories` table).
 */
export async function moveCategory(name, direction) {
  const index = cache.indexOf(name)
  const target = index + direction
  if (index < 0 || target < 0 || target >= cache.length) return false

  const a = cache[index]
  const b = cache[target]
  const aOrder = sortOrderByName.get(a) ?? index
  const bOrder = sortOrderByName.get(b) ?? target

  const client = requireClient()
  const [first, second] = await Promise.all([
    client.from('categories').update({ sort_order: bOrder }).eq('name', a),
    client.from('categories').update({ sort_order: aOrder }).eq('name', b),
  ])

  const failure = first.error || second.error
  if (failure) throw new Error(failure.message)

  sortOrderByName.set(a, bOrder)
  sortOrderByName.set(b, aOrder)

  const next = [...cache]
  next[index] = b
  next[target] = a
  cache = next

  notify()
  return true
}

/**
 * 改名 / 合并。两条路径分开走，判据见 utils/categoryRename.js。
 *
 *   rename（新名字没人用过）：一条 `update categories set name = …`，
 *     商品由外键 `ON UPDATE CASCADE` 自己跟过去，`sort_order` 原样保留。
 *   merge（新名字已存在）：级联并不过去，先搬商品再删旧行。
 *
 * ⚠️ 纯改名**绝不能先搬商品**。商品的 BEFORE UPDATE 触发器 `ensure_category`
 * 会在改名 UPDATE 之前就把新名字插进 categories（`sort_order = max + 1`），
 * 于是那条 UPDATE 撞主键失败 —— 现象就是"改个名，原分类空了、新分类跑到最底"。
 */
export async function renameCategory(from, to) {
  const plan = planCategoryRename(from, to, cache)
  if (plan.mode === 'noop') return { ok: false, moved: 0, merged: false }

  const client = requireClient()

  if (plan.mode === 'merge') {
    /* 目标行已经存在，`ensure_category` 的 insert 会 `on conflict do nothing`，
     * 所以先搬商品不会新建任何行；搬完再删旧行，排序取目标行自己的。 */
    const moved = await setProductsCategory(plan.from, plan.to)
    const { error } = await client.from('categories').delete().eq('name', plan.from)
    if (error) throw new Error(error.message)

    cache = cache.filter((name) => name !== plan.from)
    sortOrderByName.delete(plan.from)
    notify()
    return { ok: true, moved, merged: true }
  }

  /* 纯改名：只改 name，不碰 products。
   * `select('name')` 是为了确认真的改到了 —— 0 行意味着这一行根本不在表里
   * （缓存过期，或这个"分类"只存在于商品上），这时宁可报错也不做破坏性补救。 */
  const { data, error } = await client
    .from('categories')
    .update({ name: plan.to })
    .eq('name', plan.from)
    .select('name')

  if (error) throw new Error(error.message)
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error(`分类「${plan.from}」不在 categories 表里，改名没有生效`)
  }

  const order = sortOrderByName.get(plan.from)
  sortOrderByName.delete(plan.from)
  if (order !== undefined) sortOrderByName.set(plan.to, order)

  cache = cache.map((name) => (name === plan.from ? plan.to : name))

  /* 商品是数据库级联改的，本地缓存里还留着旧名字 —— 不刷新的话，分类栏已经
   * 叫新名字了，商品卡片上还写着旧的。silent：不要让列表闪一下骨架。
   * 失败不影响改名本身（库里已经改了），下次拉取会自己对齐。 */
  await loadProducts({ silent: true }).catch(() => {})

  notify()
  return { ok: true, moved: 0, merged: false }
}

/**
 * Drop a category. Its products move to the fallback bucket first, otherwise
 * the ON DELETE RESTRICT foreign key would reject the delete.
 */
export async function removeCategory(name) {
  if (!cache.includes(name)) return { ok: false, moved: 0 }

  const moved = await setProductsCategory(name, 'Uncategorised')

  const { error } = await requireClient().from('categories').delete().eq('name', name)
  if (error) throw new Error(error.message)

  cache = cache.filter((existing) => existing !== name)
  sortOrderByName.delete(name)
  notify()
  return { ok: true, moved }
}
