/**
 * dsh-topic-graph — 会话话题图谱（Host 半）
 *
 * 把每个 dsh 会话按「轮次 turn」切分，再让 DeepSeek 把轮次增量聚合成
 * 「话题 topic」与「阶段 stage」：
 *   - 轮次：一次 turn/start → turn/end 之间的一问一答（可含多次工具调用）。
 *   - 话题：若干连续轮次组成的一条工作线；话题可嵌套子话题（由 AI 判断）。
 *   - 阶段：若干相邻话题组成的工作阶段；阶段与话题都有 AI 取的名字。
 *
 * 数据来源：
 *   1. 历史会话：ctx.sessionQuery.readSession(id) 一次性重放事件日志；
 *   2. 实时会话：ctx.on('session/event') 增量折叠，按 seq 去重。
 *   折叠出的轮次统计（token 用量、工具调用、Agent 耗时）是唯一事实缓存，
 *   AI 只负责「轮次 → 话题/阶段」的结构划分，结构持久化在
 *   <DSH_HOME>/data/topic-graph/<sessionId>.json（原子写、防抖）。
 *
 * 增量切分：每次只把「尚未切分的轮次摘要 + 已有话题/阶段结构」发给模型，
 * 已有轮次的正文不会重复输入；模型输出更新后的完整结构（很小），
 * Host 校验轮次覆盖、父子关系与阶段归属后落盘。
 *
 * 浏览器半通过 webServer 路由取数：
 *   GET  /plugins/topic-graph/ping
 *   GET  /plugins/topic-graph/sessions
 *   GET  /plugins/topic-graph/graph?sessionId=&version=
 *   POST /plugins/topic-graph/segment   { sessionId?, full? }
 */

import { readFile, writeFile, mkdir, readdir, rename, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import os from 'node:os'

export const name = 'dsh-topic-graph'
export const inject = ['webServer', 'sessionQuery']

// ── 常量 ────────────────────────────────────────────────────────────────────

const ROUTE_BASE = '/plugins/topic-graph'
const DATA_DIR_NAME = 'topic-graph'
const SAVE_DEBOUNCE_MS = 500
const TITLE_TTL_MS = 60000
const SESSIONS_TTL_MS = 10000
const SESSIONS_LIMIT = 150
const TOPIC_TITLE_MAX = 16
const STAGE_TITLE_MAX = 10
const SUMMARY_MAX = 60
const TURN_PROMPT_MAX = 600
const TURN_ASSISTANT_MAX = 400
// /graph 里每轮正文只发预览（折叠全文保留在 Host 内存供 AI；完整正文在聊天里）
const TURN_PROMPT_PREVIEW = 200
const TURN_ASSISTANT_PREVIEW = 160
// 单轮 AI 分析：轨迹重建的截断与上限
const TURN_TRACE_MAX_ITEMS = 24
const TURN_TRACE_ARGS_MAX = 160
const TURN_TRACE_RESULT_MAX = 360
const TURN_TRACE_TEXT_MAX = 360
const TURN_ANALYSIS_STEPS_MAX = 8
// 内存中的会话图 LRU 上限（超出后写回磁盘并淘汰，磁盘副本仍是底稿）
const GRAPHS_MAX = 40
const MODEL_FILE = '.model.json'
const TITLE_CACHE_MAX = 2000

/** 用户直接输入的消息 source.kind（其余是 dsh 注入的上下文 / 审批通知等）。 */
const DIRECT_USER_KINDS = new Set(['user', 'goal'])

// ── 通用小工具 ──────────────────────────────────────────────────────────────

function nowIso() { return new Date().toISOString() }

/** 会话 id 规范化：dsh 里同时存在 `session-<uuid>` 与裸 `<uuid>` 两种写法。 */
function normSessionId(id) {
  return String(id || '').replace(/^session-/, '')
}

/** 候选 id 形式（读会话日志时逐个尝试）。 */
function sessionIdCandidates(id) {
  const raw = String(id || '')
  const bare = normSessionId(raw)
  const out = []
  for (const candidate of [raw, bare, `session-${bare}`]) {
    if (candidate && !out.includes(candidate)) out.push(candidate)
  }
  return out
}

function clampInt(value, fallback, min, max) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, Math.floor(n)))
}

/** 压缩空白并截断到 max 个字符（按 code unit，够用且不拆代理对风险低）。 */
function summarize(text, max = 80) {
  const cleaned = String(text ?? '').replace(/\s+/g, ' ').trim()
  const chars = Array.from(cleaned)
  if (chars.length <= max) return cleaned
  return `${chars.slice(0, max).join('')}…`
}

/** dsh 事件 time → 毫秒时间戳；拿不到返回 0。 */
function normalizeTime(value) {
  let ms = 0
  if (typeof value === 'number' && Number.isFinite(value)) ms = value
  else if (typeof value === 'string' && value) {
    if (/^\d+$/.test(value)) ms = Number(value)
    else {
      const d = new Date(value)
      return Number.isNaN(d.getTime()) ? 0 : d.getTime()
    }
  }
  if (!ms) return 0
  if (ms < 1e12) ms *= 1000 // 10 位秒级补成毫秒
  return ms
}

/** 从 content blocks 提取文本（可限定 block 类型，按字符上限截断）。 */
function extractBlocksText(content, max = 400, types = null) {
  if (!Array.isArray(content)) return ''
  let out = ''
  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    if (block.type !== 'text' && block.type !== 'reasoning') continue
    if (types && !types.includes(block.type)) continue
    if (typeof block.text === 'string' && block.text.length > 0) {
      out += (out ? '\n' : '') + block.text
      if (out.length >= max) break
    }
  }
  return summarize(out, max)
}

/** 统计 reasoning 文本长度（不保留正文，省内存）。 */
function countBlocksText(content, types = ['reasoning']) {
  if (!Array.isArray(content)) return 0
  let total = 0
  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    if (!types.includes(block.type)) continue
    if (typeof block.text === 'string') total += block.text.length
  }
  return total
}

function emptyTokens() {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, total: 0 }
}

function addUsage(turn, usage) {
  if (!usage || typeof usage !== 'object') return
  const u = turn.tokens
  const input = numOr0(usage.inputTokens)
  const output = numOr0(usage.outputTokens)
  const cacheRead = numOr0(usage.cacheReadTokens)
  const cacheWrite = numOr0(usage.cacheWriteTokens)
  const reasoning = numOr0(usage.reasoningTokens)
  u.input += input
  u.output += output
  u.cacheRead += cacheRead
  u.cacheWrite += cacheWrite
  u.reasoning += reasoning
  const explicit = numOr0(usage.totalTokens)
  u.total += explicit > 0 ? explicit : input + output + cacheRead + cacheWrite
}

/** 把一次 LLM 调用的用量累进图级成本统计。 */
function accumulateAiUsage(g, usage) {
  if (!g || !usage) return
  const t = g.aiTokens
  t.input += numOr0(usage.input)
  t.output += numOr0(usage.output)
  t.cacheRead += numOr0(usage.cacheRead)
  t.cacheWrite += numOr0(usage.cacheWrite)
  t.total += numOr0(usage.total)
}

function numOr0(value) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : 0
}

function isSubagentHeader(header) {
  if (!header || typeof header !== 'object') return false
  if (header.origin === 'subagent') return true
  if (typeof header.parentSession === 'string' && header.parentSession
    && Number(header.delegationDepth) > 0) return true
  return false
}

function isSubagentSession(session) {
  if (!session || typeof session !== 'object') return false
  if (session.origin === 'subagent') return true
  return isSubagentHeader(session.header)
}

// ── HTTP 小工具 ─────────────────────────────────────────────────────────────

function sendJson(res, code, value) {
  const body = JSON.stringify(value)
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  })
  res.end(body)
}

async function readJsonBody(req, limit = 1024 * 1024) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw new Error('request body too large')
    chunks.push(chunk)
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim()
  if (!raw) return {}
  return JSON.parse(raw)
}

// ── 容错 JSON 解析（模型输出可能带围栏 / 截断） ─────────────────────────────

function repairTruncatedJson(text) {
  const start = text.indexOf('{')
  if (start === -1) return null
  const slice = text.slice(start)
  let out = ''
  let inString = false
  const stack = []
  for (let i = 0; i < slice.length; i += 1) {
    const ch = slice[i]
    out += ch
    if (inString) {
      if (ch === '\\') { out += slice[i + 1] || ''; i += 1; continue }
      if (ch === '"') inString = false
      continue
    }
    if (ch === '"') { inString = true; continue }
    if (ch === '{' || ch === '[') stack.push(ch === '{' ? '}' : ']')
    else if (ch === '}' || ch === ']') { if (stack.length > 0) stack.pop() }
  }
  // 截断点可能落在字符串 / 转义符 / 半截键上：先清理再补括号
  if (inString) {
    out = out.replace(/\\+$/, '')
    out += '"'
  }
  out = out.replace(/,\s*"[^"]*"\s*:\s*$/, '') // 半截的 "key":
  out = out.replace(/,\s*$/, '')
  while (stack.length > 0) out += stack.pop()
  try {
    JSON.parse(out)
    return out
  } catch {
    return null
  }
}

function parseGraphJson(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidates = []
  if (fenced && fenced[1]) candidates.push(fenced[1])
  candidates.push(raw)
  for (const candidate of candidates) {
    const start = candidate.indexOf('{')
    const end = candidate.lastIndexOf('}')
    if (start !== -1 && end > start) {
      try {
        const parsed = JSON.parse(candidate.slice(start, end + 1))
        if (parsed && (Array.isArray(parsed.topics) || Array.isArray(parsed.stages) || Array.isArray(parsed.relations))) return parsed
      } catch { /* try next */ }
    }
    const repaired = repairTruncatedJson(candidate)
    if (repaired) {
      try {
        const parsed = JSON.parse(repaired)
        if (parsed && (Array.isArray(parsed.topics) || Array.isArray(parsed.stages) || Array.isArray(parsed.relations))) return parsed
      } catch { /* try next */ }
    }
  }
  return null
}

// ── LLM ─────────────────────────────────────────────────────────────────────

/** 读取未在 inject 中声明的可选服务：直接属性访问会被 Cordis 的 inject 检查拦截。 */
function getHostService(ctx, name) {
  try {
    if (typeof ctx.get === 'function') return ctx.get(name)
  } catch { /* fall through */ }
  try {
    return ctx[name]
  } catch {
    return undefined
  }
}

/** 解析 dsh 当前配置的模型路由；config 优先，否则探测。 */
async function resolveLlmTarget(llm, cfg) {
  if (!llm || typeof llm.stream !== 'function') throw new Error('llm service unavailable')
  let providers = []
  try {
    const listed = llm.listProviders()
    providers = (listed && typeof listed.then === 'function') ? await listed : listed
  } catch {
    providers = []
  }
  providers = Array.isArray(providers) ? providers : []
  const provider = (typeof cfg.provider === 'string' && cfg.provider) || providers[0]?.id
  if (!provider) throw new Error('no llm provider available')
  if (typeof cfg.model === 'string' && cfg.model) return { provider, model: cfg.model }
  try {
    const models = await llm.listModels(provider)
    const fallback = Array.isArray(models) ? models[0]?.id : undefined
    if (fallback) return { provider, model: fallback }
  } catch { /* fall through */ }
  throw new Error(`no model resolved for provider "${provider}"`)
}

/** 调一次模型，拼接 text-delta 输出。 */
/** 从 llm finish 失败事实构造带 code/status 的 Error（供上层做自适应重试）。 */
function llmFailureError(failure, fallbackMessage) {
  const message = failure && typeof failure === 'object' && typeof failure.message === 'string' && failure.message
    ? failure.message
    : (fallbackMessage || 'llm request failed')
  const error = new Error(message)
  if (failure && typeof failure === 'object') {
    if (typeof failure.code === 'string') error.code = failure.code
    if (typeof failure.status === 'number') error.status = failure.status
  }
  return error
}

/** 把模型错误压成一行可展示文本（带 code/status，便于定位 400 之类的问题）。 */
function describeLlmError(error) {
  const code = typeof error?.code === 'string' ? error.code : ''
  const status = typeof error?.status === 'number' ? `HTTP ${error.status}` : ''
  if (code === 'PARSE_OUTPUT') {
    return '模型输出被截断或不是合法 JSON（已自动用更大输出上限重试；可稍后重试/全部重切）'
  }
  const message = summarize(String(error?.message || error || 'AI 请求失败'), 180)
  return [code, status, message].filter(Boolean).join(' · ')
}

/** 调一次模型，拼接 text-delta 输出。effortOverride 传 null 表示使用适配器默认推理档位。 */
async function llmText(ctx, cfg, system, userText, maxTokens, effortOverride) {
  const llm = getHostService(ctx, 'llm')
  const { provider, model } = await resolveLlmTarget(llm, cfg)
  // 输出上限不能超过模型自己的 maxTokens，否则部分 provider 会直接 400
  let cappedMaxTokens = maxTokens
  try {
    if (typeof llm.resolveModelInfo === 'function') {
      const info = await llm.resolveModelInfo(provider, model)
      const modelMax = Number(info?.maxTokens)
      if (Number.isFinite(modelMax) && modelMax > 0) cappedMaxTokens = Math.min(cappedMaxTokens, modelMax)
    }
  } catch { /* 模型信息取不到就按原值请求 */ }
  const effort = effortOverride === undefined ? (cfg.reasoningEffort || 'off') : effortOverride
  let text = ''
  let failure = null
  const usage = emptyTokens()
  for await (const chunk of llm.stream({
    provider,
    model,
    messages: [{ role: 'user', content: [{ type: 'text', text: userText }] }],
    system,
    temperature: 0.2,
    maxTokens: cappedMaxTokens,
    ...(effort ? { reasoningEffort: effort } : {}),
  })) {
    if (!chunk || typeof chunk !== 'object') continue
    if (chunk.type === 'text-delta' && typeof chunk.text === 'string') text += chunk.text
    else if (chunk.type === 'usage' && chunk.usage && typeof chunk.usage === 'object') {
      const u = chunk.usage
      usage.input += numOr0(u.inputTokens)
      usage.output += numOr0(u.outputTokens)
      usage.cacheRead += numOr0(u.cacheReadTokens)
      usage.cacheWrite += numOr0(u.cacheWriteTokens)
      const explicit = numOr0(u.totalTokens)
      usage.total += explicit > 0 ? explicit : numOr0(u.inputTokens) + numOr0(u.outputTokens) + numOr0(u.cacheReadTokens) + numOr0(u.cacheWriteTokens)
    } else if (chunk.type === 'finish') {
      const reason = chunk.reason
      if (reason && (reason.kind === 'error' || reason.kind === 'aborted')) {
        failure = reason.failure || { message: reason.kind }
      }
    }
  }
  if (failure) throw llmFailureError(failure, 'llm request failed')
  return { text, provider, model, maxTokens: cappedMaxTokens, usage }
}

/**
 * 模型报 400 / INVALID_REQUEST 时换适配器默认推理档位再试一次：
 * 部分模型对显式 thinking 开关比较挑剔，去掉显式档位能避开这类 400。
 */
function shouldRetryWithDefaultEffort(error) {
  const code = String(error?.code || '').toUpperCase()
  const status = Number(error?.status) || 0
  return status === 400
    || code === 'INVALID_REQUEST'
    || code === 'UNSUPPORTED_REASONING_EFFORT'
    || /request failed \(400\)/i.test(String(error?.message || ''))
}

// ── 提示词 ──────────────────────────────────────────────────────────────────

const SEGMENT_SYSTEM_PROMPT = [
  '你是一个「会话话题图谱切分器」。用户与 AI 在 DeepSeek Harness 中协作，每一轮（轮次）是一问一答，可能包含多次工具调用。',
  '你的任务：把轮次按工作主题聚合成「话题 topic」，把话题按推进顺序聚合成「阶段 stage」，并为每个话题、阶段命名。',
  '【切分规则】',
  '1. 一个话题 = 一条独立的工作意图/任务线，聚合若干连续轮次；通常 1~6 轮，长任务可以更多。',
  '2. 子话题：只有当一个话题内部出现明显独立、值得单独查看的子任务（如大任务下的子模块实现、某个错误的专项排查）时，才建立子话题：子话题的 parentId 指向父话题，轮次范围落在父话题范围内。没有必要时不要建子话题（宁可扁平）。子话题最多 3 层（根话题算第 1 层），不要超过 3 层。',
  '3. 阶段 = 工作推进的大阶段（如：需求澄清、方案设计、实现、排错、验收）。一个阶段聚合若干按时间相邻的话题；通常 1~4 个阶段，长会话可以更多。每个话题必须属于恰好一个阶段（子话题跟随父话题）。',
  '4. 所有轮次必须恰好被一个话题覆盖，不允许遗漏或重复；父子话题嵌套时，子话题覆盖它自己的轮次，父话题覆盖其余轮次。',
  '5. 已有话题/阶段的 id 与命名尽量保留，只在内容确实变化时修改；新轮次只能并入已有话题、新建话题或新建子话题，不要重排历史。',
  '6. 命名要求：话题标题 ≤12 个汉字（英文 ≤24 字符），必须具体描述工作内容，禁止“工作”“任务”“对话”“进行中”等泛化词；阶段标题 ≤8 字；摘要 ≤40 字。输出语言与输入记录的主要语言一致。',
  '7. 关系边：如果两个话题之间存在明显语义关系（依赖 / 延续 / 对比 / 修复 / 验证 / 回访 / 同一目标），可在 relations 里输出一条有向关系边；label 用 2~6 个字的动词短语。相邻顺序关系（next）与阶段归属（belongTo）由系统自动生成，不要重复输出；没有信息量的关系不要输出，最多 12 条。',
  '8. 只输出纯 JSON，禁止 markdown 代码块、注释或任何解释文字。',
  '【输出格式】',
  '{"topics":[{"id":"已有话题id（新话题省略）","tempId":"新话题的临时id","title":"话题名","summary":"一句话摘要","parentId":"父话题id或null","turnStart":1,"turnEnd":3,"status":"active或done"}],"stages":[{"id":"已有阶段id（新阶段省略）","tempId":"新阶段临时id","title":"阶段名","summary":"阶段摘要","topicRefs":["话题id或tempId"]}],"relations":[{"from":"话题id或tempId","to":"话题id或tempId","label":"关系词"}]}',
  '注意：topics 必须输出全部话题（已有 + 新增），stages 必须输出全部阶段（已有 + 新增），relations 只需输出确实存在的关系（可省略）；已有 id 原样保留，topicRefs / relations 引用话题的 id 或 tempId。',
].join('\n')

function renderTurnLine(turn) {
  const tools = Object.entries(turn.toolCalls.byName || {})
    .sort((a, b) => b[1] - a[1])
    .map(([toolName, count]) => `${toolName}×${count}`)
    .join(', ')
  const parts = [`[轮${turn.turn}]`, `用户: ${summarize(turn.prompt || '(无文本)', 240)}`]
  if (turn.assistant) parts.push(`AI: ${summarize(turn.assistant, 200)}`)
  if (tools) parts.push(`工具: ${tools}`)
  if (turn.tokens.total > 0) parts.push(`tokens≈${turn.tokens.total}`)
  return parts.join(' | ')
}

function topicDepth(topicsById, topic, guard = 0) {
  if (!topic || !topic.parentId || guard > 20) return 0
  const parent = topicsById.get(topic.parentId)
  if (!parent) return 0
  return 1 + topicDepth(topicsById, parent, guard + 1)
}

function renderExistingStructure(g) {
  if (!g.topics.length && !g.stages.length) return ''
  const lines = []
  if (g.stages.length) {
    lines.push('【已有阶段（按顺序）】')
    for (const stage of g.stages) {
      const rootIds = g.topics.filter((t) => t.parentId == null && t.stageId === stage.id).map((t) => t.id)
      lines.push(`- ${stage.id} "${stage.title}"${stage.summary ? `（${summarize(stage.summary, 24)}）` : ''} 话题: ${rootIds.join(', ') || '无'}`)
    }
  }
  if (g.topics.length) {
    const byId = new Map(g.topics.map((t) => [t.id, t]))
    const children = childrenIndex(g)
    // 话题数很多时，摘要对「判断新轮次归属」帮助有限，省掉以缩短请求
    const withSummary = g.topics.length <= 60
    lines.push('【已有话题】')
    for (const topic of g.topics) {
      const turnNums = allTurnNums(g, topic, children)
      const range = turnNums.length ? `轮${turnNums[0]}-轮${turnNums[turnNums.length - 1]}` : '无轮次'
      const parent = topic.parentId ? ` 父话题:${topic.parentId}` : ''
      const stage = topic.parentId ? '' : ` 阶段:${topic.stageId || '?'}`
      const summary = withSummary ? ` 摘要:${summarize(topic.summary || '无', 40)}` : ''
      lines.push(`- ${topic.id} "${topic.title}" ${range} 状态:${topic.status}${stage}${parent}${summary}`)
      if (lines.length > 220) { lines.push(`- …（其余 ${g.topics.length - lines.length + 3} 个话题省略）`); break }
    }
    if (g.relations.length) {
      lines.push('【已有关系（供参考，可更新）】')
      lines.push(g.relations.slice(0, 20).map((rel) => `${rel.from}→${rel.to}:${rel.label}`).join('; '))
    }
    // 避免 byId 未使用告警（保持结构清晰）
    void byId
  }
  return lines.join('\n')
}

// ── 图状态 ──────────────────────────────────────────────────────────────────

/** 插件运行期状态。HMR 重载时模块重新求值，旧实例的状态随旧闭包被替换。 */
let stateRef = null

function createState() {
  return {
    graphs: new Map(),
    sessionParents: new Map(),
    lineageAt: 0,
    lastSeen: new Map(),
    titleCache: new Map(),
    segmentKeys: new Set(),
    sessionsCache: null,
    dataVersion: 0,
  }
}

function stateOf() {
  if (!stateRef) stateRef = createState()
  return stateRef
}

/** 会话图 LRU：超出上限时把最久未用的图写回磁盘并从内存移除（磁盘副本仍在）。 */
function evictGraphsIfNeeded(state) {
  if (state.graphs.size <= GRAPHS_MAX) return
  const candidates = [...state.graphs.entries()]
    .filter(([, g]) => g.ready && !g.loading && !g.segRunning)
    .sort((a, b) => (a[1].lastUsedAt || 0) - (b[1].lastUsedAt || 0))
  for (const [key, g] of candidates) {
    if (state.graphs.size <= GRAPHS_MAX) break
    clearTimeout(g.saveTimer)
    clearTimeout(g.segmentTimer)
    if (g.topics.length) void saveGraphNow(g)
    state.graphs.delete(key)
  }
}

/** 记录访问时间，触发按需淘汰。 */
function touchGraph(g) {
  g.lastUsedAt = Date.now()
}

/** titleCache 上限保护。 */
function capTitleCache(state) {
  if (state.titleCache.size <= TITLE_CACHE_MAX) return
  let excess = state.titleCache.size - TITLE_CACHE_MAX
  for (const key of state.titleCache.keys()) {
    state.titleCache.delete(key)
    if (--excess <= 0) break
  }
}

/** 记录 / 刷新一个会话的血缘元信息（父子会话、委托深度）。 */
function updateSessionMeta(sessionId, header) {
  if (!sessionId || !header) return
  const key = normSessionId(sessionId)
  const state = stateOf()
  const prev = state.sessionParents.get(key) || {}
  // 两个来源（listSessions 的完整 header / readSession 的 snapshot.session）可能字段不全：
  // header 明确给出 parentSession 才覆盖，否则沿用已记录的父子关系。
  const parentKey = header.parentSession
    ? normSessionId(header.parentSession)
    : (prev.parentKey || null)
  const depth = header.delegationDepth != null
    ? Number(header.delegationDepth) || 0
    : (prev.depth != null
      ? prev.depth
      : (parentKey ? (state.sessionParents.get(parentKey)?.depth || 0) + 1 : 0))
  state.sessionParents.set(key, {
    id: header.id || sessionId,
    key,
    parentKey,
    depth,
    isSubagent: isSubagentHeader(header),
    title: prev.title || '',
    cwd: header.cwd || prev.cwd || '',
    createdAt: header.createdAt || prev.createdAt || 0,
    lastActiveAt: prev.lastActiveAt || 0,
  })
}

/** 收集某会话下的子智能体会话（含更深层），带环检测与深度上限。 */
function collectDescendants(parentKey, maxDepth = 2) {
  const state = stateOf()
  const rootKey = normSessionId(parentKey)
  const out = []
  const visited = new Set([rootKey])
  const walk = (key, depth) => {
    if (depth > maxDepth) return
    for (const [childKey, meta] of state.sessionParents.entries()) {
      if (meta.parentKey !== key || visited.has(childKey)) continue
      visited.add(childKey)
      out.push({ key: childKey, id: meta.id || `session-${childKey}`, depth, meta })
      walk(childKey, depth + 1)
    }
  }
  walk(rootKey, 1)
  out.sort((a, b) => (a.meta.createdAt || 0) - (b.meta.createdAt || 0))
  return out
}

/** 子会话是在父会话哪一轮启动的：优先按子会话首轮开始时间落进父轮次区间。 */
function findParentTurnForTime(parentGraph, time) {
  if (!parentGraph || !parentGraph.turns.length) return null
  const t = Number(time) || 0
  if (t <= 0) return parentGraph.turns[parentGraph.turns.length - 1].turn
  let best = null
  for (const turn of parentGraph.turns) {
    const start = turn.startTime || 0
    const end = Math.max(turn.endTime || 0, turn.lastTime || 0)
    if (start <= t && t <= end) return turn.turn
    if (start <= t) best = turn.turn
  }
  return best != null ? best : parentGraph.turns[0].turn
}

function createGraph(sessionId) {
  return {
    sessionId,
    key: normSessionId(sessionId),
    ready: false,
    loading: null,
    pending: [],
    pendingPrompts: [],
    turns: [],
    turnIndex: new Map(),
    openSteps: new Map(),
    topics: [],
    stages: [],
    relations: [],
    relationsSignature: '',
    relationError: '',
    llmLastErrorAt: '',
    aiRetriedAt: '',
    segBatchLimit: 0,
    parentSessionId: null,
    depth: 0,
    subagentLinks: [],
    topicSeq: 0,
    stageSeq: 0,
    segmentedThroughTurn: 0,
    lastAssignedTopicId: null,
    aiStatus: 'idle',
    aiError: '',
    aiMode: '',
    aiTokens: emptyTokens(),
    aiCalls: 0,
    aiProgress: 0,
    turnAnalyses: {},
    llmProvider: '',
    llmModel: '',
    lastAiAt: '',
    lastEventAt: 0,
    lastSeq: -1,
    version: 0,
    saveTimer: null,
    segmentTimer: null,
    segRunning: false,
    segQueued: false,
    segQueuedFull: false,
    lastSegAt: 0,
    lastUsedAt: 0,
    updatedAt: '',
  }
}

function newTurn(turn, time) {
  return {
    turn,
    startSeq: null,
    endSeq: null,
    startTime: time || 0,
    endTime: time || 0,
    lastTime: time || 0,
    prompt: '',
    assistant: '',
    reasoningChars: 0,
    tokens: emptyTokens(),
    toolCalls: { total: 0, byName: {} },
    toolErrors: 0,
    steps: 0,
    requests: 0,
    agentMs: 0,
    status: 'open',
    provider: '',
    model: '',
  }
}

function ensureTurn(g, turnNumber, time) {
  const n = Number(turnNumber)
  if (!Number.isInteger(n) || n < 1) return null
  let turn = g.turnIndex.get(n)
  if (!turn) {
    turn = newTurn(n, time)
    g.turns.push(turn)
    g.turnIndex.set(n, turn)
    g.turns.sort((a, b) => a.turn - b.turn)
  }
  if (time && time > turn.lastTime) turn.lastTime = time
  return turn
}

function currentOpenTurn(g) {
  for (let i = g.turns.length - 1; i >= 0; i -= 1) {
    if (g.turns[i].status === 'open') return g.turns[i]
  }
  return g.turns[g.turns.length - 1]
}

function turnEndStatus(reason) {
  const kind = reason && typeof reason === 'object' ? reason.kind : ''
  if (kind === 'aborted') return 'aborted'
  if (kind === 'error') return 'error'
  if (kind === 'interrupted') return 'interrupted'
  return 'done'
}

function closeOpenSteps(g, turn, endTime) {
  const prefix = `${turn.turn}:`
  for (const [key, startTime] of [...g.openSteps.entries()]) {
    if (!key.startsWith(prefix)) continue
    const elapsed = Math.max(0, (endTime || startTime) - startTime)
    turn.agentMs += elapsed
    g.openSteps.delete(key)
  }
}

/** 把一条已提交的 session 事件折叠进图状态。 */
function applyEvent(g, event) {
  if (!event || typeof event.type !== 'string') return false
  const data = event.data && typeof event.data === 'object' ? event.data : {}
  const time = normalizeTime(event.time) || Date.now()
  const seq = Number.isInteger(event.seq) ? event.seq : g.lastSeq + 1
  if (seq <= g.lastSeq) return false // 已折叠过的历史事件（导入后又收到实时事件）
  g.lastSeq = seq
  if (time > g.lastEventAt) g.lastEventAt = time

  const type = event.type
  if (type === 'agent/inbox/spliced') {
    // 下一轮排队进来的用户消息：先记住，等 turn/start 归位（比 currentOpenTurn 更稳）
    if (data.target === 'next-turn' && Array.isArray(data.inserted)) {
      for (const msg of data.inserted) {
        const kind = msg?.source?.kind
        if (!DIRECT_USER_KINDS.has(kind)) continue
        const text = extractBlocksText(msg?.content, TURN_PROMPT_MAX, ['text'])
        if (text) g.pendingPrompts.push(text)
        break
      }
    }
    return true
  }
  if (type === 'turn/start') {
    const turn = ensureTurn(g, data.turn, time)
    if (turn) {
      if (!turn.startTime) turn.startTime = time
      if (turn.startSeq == null) turn.startSeq = seq
      turn.status = 'open'
      if (!turn.prompt && g.pendingPrompts.length) turn.prompt = g.pendingPrompts.shift()
    }
    return true
  }
  if (type === 'turn/end') {
    const turn = ensureTurn(g, data.turn != null ? data.turn : g.turns[g.turns.length - 1]?.turn, time)
    if (turn) {
      turn.endTime = time
      turn.endSeq = seq
      turn.status = turnEndStatus(data.reason)
      closeOpenSteps(g, turn, time)
    }
    return true
  }
  if (type === 'step/start') {
    const turn = ensureTurn(g, data.turn, time)
    if (turn) {
      turn.steps += 1
      g.openSteps.set(`${turn.turn}:${data.step}`, time)
    }
    return true
  }
  if (type === 'step/end') {
    const turn = ensureTurn(g, data.turn, time)
    if (turn) {
      const key = `${turn.turn}:${data.step}`
      const startTime = g.openSteps.get(key)
      if (startTime != null) {
        turn.agentMs += Math.max(0, time - startTime)
        g.openSteps.delete(key)
      }
    }
    return true
  }
  if (type === 'user/message') {
    const message = data.message && data.message.content ? data.message : data
    const kind = message?.source?.kind
    if (DIRECT_USER_KINDS.has(kind)) {
      const text = extractBlocksText(message.content, TURN_PROMPT_MAX, ['text'])
      if (text) {
        const turn = currentOpenTurn(g)
        if (turn && !turn.prompt) turn.prompt = text
      }
    }
    return true
  }
  if (type === 'assistant/message') {
    const turn = ensureTurn(g, data.turn, time)
    if (!turn) return true
    turn.requests += 1
    const message = data.message
    const text = extractBlocksText(message?.content, TURN_ASSISTANT_MAX, ['text'])
    if (text) turn.assistant = text
    turn.reasoningChars += countBlocksText(message?.content, ['reasoning'])
    addUsage(turn, data.usage)
    const source = message?.source
    if (source && source.kind === 'model') {
      if (source.model) turn.model = String(source.model)
      if (source.provider) turn.provider = String(source.provider)
    }
    return true
  }
  if (type === 'tool/call') {
    const turn = ensureTurn(g, data.turn, time)
    if (turn && data.name) {
      turn.toolCalls.total += 1
      const map = turn.toolCalls.byName
      map[data.name] = (map[data.name] || 0) + 1
    }
    return true
  }
  if (type === 'tool/result') {
    const turn = ensureTurn(g, data.turn, time)
    if (turn) {
      const isError = data.message?.isError === true || data.isError === true
      if (isError) turn.toolErrors += 1
    }
    return true
  }
  return false
}

/** 冻结一份轮次数组，避免读路径与折叠路径互相踩。 */
function snapshotTurns(g) {
  return g.turns.map((t) => ({ ...t, tokens: { ...t.tokens }, toolCalls: { total: t.toolCalls.total, byName: { ...t.toolCalls.byName } } }))
}

// ── 会话导入（读历史日志 + 恢复切分结果） ───────────────────────────────────

async function readSessionEvents(ctx, sessionId) {
  if (!ctx.sessionQuery || typeof ctx.sessionQuery.readSession !== 'function') return null
  let lastError = null
  for (const candidate of sessionIdCandidates(sessionId)) {
    try {
      const snapshot = await ctx.sessionQuery.readSession(candidate)
      if (snapshot && Array.isArray(snapshot.events)) return snapshot
    } catch (error) {
      lastError = error
    }
  }
  if (lastError) throw lastError
  return null
}

function rebuildFromEvents(g, events) {
  g.turns = []
  g.turnIndex = new Map()
  g.openSteps = new Map()
  g.pendingPrompts = []
  g.lastSeq = -1
  g.lastEventAt = 0
  for (const event of events) applyEvent(g, event)
  // 收尾：日志重放时不应留下 open 的步骤；未闭合的轮次按最后事件时间标记
  for (const turn of g.turns) {
    if (turn.status === 'open' && turn.endTime && turn.endTime > turn.startTime) {
      // 事件里确实没有 turn/end 的旧日志：保守视为已结束（最后一条事件的时间）
      if (turn.endSeq != null) turn.status = 'done'
    }
    if (turn.endTime < turn.startTime) turn.endTime = turn.startTime
    if (turn.endSeq == null) {
      // 未闭合轮次（正在运行的最后一次 turn）：保留 open 语义，用最后事件时间算耗时
      turn.endTime = Math.max(turn.endTime, turn.lastTime)
    }
  }
}

// ── 单轮轨迹重建（按需，不驻留内存） ───────────────────────────────────────

/** 从原始事件里重建某一轮的「模型 / 工具」有序轨迹（扁平、带截断）。 */
function buildTurnTrace(events, turnNumber) {
  const items = []
  if (!Array.isArray(events)) return items
  for (const event of events) {
    if (!event || typeof event.type !== 'string') continue
    const data = event.data && typeof event.data === 'object' ? event.data : {}
    if (data.turn !== turnNumber) continue
    const type = event.type
    if (type === 'tool/call') {
      items.push({
        kind: 'tool',
        name: String(data.name || 'tool'),
        args: typeof data.arguments === 'string' && data.arguments ? summarize(data.arguments, TURN_TRACE_ARGS_MAX) : '',
        ok: null,
        result: '',
      })
    } else if (type === 'tool/result') {
      const msg = data.message && typeof data.message === 'object' ? data.message : {}
      const isError = msg.isError === true || data.isError === true
      const result = summarize(extractBlocksText(msg.content, TURN_TRACE_RESULT_MAX, ['text']), TURN_TRACE_RESULT_MAX)
      const last = items[items.length - 1]
      if (last && last.kind === 'tool' && last.ok == null) {
        last.ok = !isError
        last.result = result || (isError ? '（失败）' : '')
      } else {
        items.push({ kind: 'tool', name: String(data.name || 'tool'), args: '', ok: !isError, result })
      }
    } else if (type === 'assistant/message') {
      const msg = data.message && typeof data.message === 'object' ? data.message : {}
      const text = summarize(extractBlocksText(msg.content, TURN_TRACE_TEXT_MAX, ['text']), TURN_TRACE_TEXT_MAX)
      const hasReasoning = countBlocksText(msg.content, ['reasoning']) > 0
      if (text || hasReasoning) items.push({ kind: 'model', text, reasoning: hasReasoning })
    }
    if (items.length >= TURN_TRACE_MAX_ITEMS) break
  }
  return items
}

/** 把轨迹渲染成给模型的线性文本。 */
function renderTurnTrace(trace) {
  const lines = []
  let step = 0
  for (const item of trace) {
    if (item.kind === 'tool') {
      step += 1
      const parts = [`[${step}] 工具 ${item.name}`]
      if (item.args) parts.push(`参数 ${item.args}`)
      if (item.ok != null) parts.push(item.ok ? `结果 ${item.result || '成功'}` : `失败 ${item.result || ''}`.trim())
      lines.push(parts.join(' | '))
    } else {
      lines.push(`[模型] ${item.reasoning ? '思考' : '输出'}: ${item.text || '（无文字）'}`)
    }
  }
  return lines.join('\n')
}

function validateLoadedSegment(g, persisted) {
  if (!persisted || typeof persisted !== 'object') return false
  const topicsRaw = Array.isArray(persisted.topics) ? persisted.topics : []
  const stagesRaw = Array.isArray(persisted.stages) ? persisted.stages : []
  const lastTurn = g.turns.length ? g.turns[g.turns.length - 1].turn : 0
  const through = clampInt(persisted.segmentedThroughTurn, 0, 0, 100000)
  if (through > lastTurn) return false // 日志回退/被改写：整份切分作废
  if (topicsRaw.length === 0) return false

  const topicIds = new Set()
  const topics = []
  for (const raw of topicsRaw) {
    if (!raw || typeof raw !== 'object') continue
    const id = typeof raw.id === 'string' && raw.id ? raw.id : ''
    if (!id || topicIds.has(id)) continue
    topicIds.add(id)
    const ownTurns = (Array.isArray(raw.ownTurns) ? raw.ownTurns : [])
      .map((n) => Number(n))
      .filter((n) => Number.isInteger(n) && n >= 1 && n <= lastTurn)
    topics.push({
      id,
      title: summarize(raw.title || '未命名话题', TOPIC_TITLE_MAX),
      summary: summarize(raw.summary || '', SUMMARY_MAX),
      parentId: typeof raw.parentId === 'string' && raw.parentId ? raw.parentId : null,
      ownTurns: [...new Set(ownTurns)].sort((a, b) => a - b),
      status: raw.status === 'active' ? 'active' : 'done',
      source: raw.source === 'rule' ? 'rule' : 'llm',
      stageId: typeof raw.stageId === 'string' && raw.stageId ? raw.stageId : null,
    })
  }
  if (!topics.length) return false
  const byId = new Map(topics.map((t) => [t.id, t]))
  // 父子关系必须存在且不成环
  for (const topic of topics) {
    if (topic.parentId && !byId.has(topic.parentId)) topic.parentId = null
  }
  for (const topic of topics) {
    let cursor = topic
    let guard = 0
    while (cursor.parentId && guard < 30) {
      cursor = byId.get(cursor.parentId)
      if (!cursor || cursor === topic) { topic.parentId = null; break }
      guard += 1
    }
  }

  const stageIds = new Set()
  const stages = []
  for (const raw of stagesRaw) {
    if (!raw || typeof raw !== 'object') continue
    const id = typeof raw.id === 'string' && raw.id ? raw.id : ''
    if (!id || stageIds.has(id)) continue
    stageIds.add(id)
    stages.push({
      id,
      title: summarize(raw.title || '阶段', STAGE_TITLE_MAX),
      summary: summarize(raw.summary || '', SUMMARY_MAX),
      order: clampInt(raw.order, stages.length, 0, 10000),
    })
  }
  if (!stages.length) {
    stages.push({ id: 's1', title: '初始阶段', summary: '', order: 0 })
  }
  // 话题的阶段归属修复：根话题必须属于一个阶段
  for (const topic of topics) {
    if (topic.parentId) continue
    if (!topic.stageId || !stageIds.has(topic.stageId)) {
      topic.stageId = stages[stages.length - 1].id
    }
  }
  for (const topic of topics) {
    if (!topic.parentId) continue
    const parent = byId.get(topic.parentId)
    topic.stageId = parent?.stageId || (stages.length ? stages[stages.length - 1].id : null)
  }

  const stageIdSet = new Set(stages.map((s) => s.id))
  const topicIdSet = new Set(topics.map((t) => t.id))
  g.relationsSignature = typeof persisted.relationsSignature === 'string' ? persisted.relationsSignature : ''
  if (persisted.aiTokens && typeof persisted.aiTokens === 'object') {
    for (const key of Object.keys(g.aiTokens)) g.aiTokens[key] = numOr0(persisted.aiTokens[key])
  }
  g.aiCalls = numOr0(persisted.aiCalls)
  g.turnAnalyses = (persisted.turnAnalyses && typeof persisted.turnAnalyses === 'object')
    ? persisted.turnAnalyses
    : {}
  g.relations = (Array.isArray(persisted.relations) ? persisted.relations : [])
    .filter((r) => r && typeof r.from === 'string' && typeof r.to === 'string'
      && topicIdSet.has(r.from) && topicIdSet.has(r.to) && r.from !== r.to)
    .map((r) => ({ from: r.from, to: r.to, label: summarize(r.label || '关联', RELATION_LABEL_MAX) }))
    .slice(0, MAX_RELATIONS)
  g.topics = topics
  g.stages = stages
  g.segmentedThroughTurn = through
  g.topicSeq = Math.max(0, ...topics.map((t) => numericSuffix(t.id)))
  g.stageSeq = Math.max(0, ...stages.map((s) => numericSuffix(s.id)))
  g.lastAssignedTopicId = null
  g.updatedAt = typeof persisted.updatedAt === 'string' ? persisted.updatedAt : ''
  return true
}

function numericSuffix(id) {
  const match = /(\d+)$/.exec(String(id || ''))
  return match ? Number(match[1]) : 0
}

async function loadPersistedSegment(g) {
  try {
    const raw = await readFile(graphFile(g), 'utf8')
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

/** 确保某会话的图已导入（只导入一次）；并发请求共享同一个 Promise。 */
async function ensureGraph(ctx, sessionId) {
  const key = normSessionId(sessionId)
  const state = stateOf()
  let g = state.graphs.get(key)
  if (!g) {
    g = createGraph(sessionId)
    state.graphs.set(key, g)
  }
  if (g.ready) { touchGraph(g); return g }
  if (g.loading) return g.loading
  g.loading = (async () => {
    let snapshot = null
    let importError = ''
    try {
      snapshot = await readSessionEvents(ctx, sessionId)
    } catch (error) {
      importError = String(error?.message || error)
    }
    if (snapshot) {
      rebuildFromEvents(g, snapshot.events || [])
      g.sessionId = snapshot.session?.id || sessionId
      g.key = normSessionId(g.sessionId)
      updateSessionMeta(g.sessionId, snapshot.session)
      const meta = stateOf().sessionParents.get(g.key)
      const parentMeta = meta?.parentKey ? stateOf().sessionParents.get(meta.parentKey) : null
      g.parentSessionId = meta?.parentKey ? (parentMeta?.id || `session-${meta.parentKey}`) : null
      g.depth = meta?.depth || 0
    }
    // 实时事件在导入期间入队，导入后按 seq 去重补折叠
    const pending = g.pending
    g.pending = []
    const persisted = await loadPersistedSegment(g)
    const restored = snapshot ? validateLoadedSegment(g, persisted) : false
    const ruleOnly = g.topics.length > 0 && g.topics.every((topic) => topic.source !== 'llm')
    if (restored && persisted && persisted.aiGenerated !== true && ruleOnly && cfgRef.segmentMode !== 'rule') {
      // 上次只落到规则切分（例如 AI 当时 400 / 不可用）→ 现在允许 AI 时重试一次；
      // 6 小时内最多重试一次，避免模型持续不可用时每次打开面板都烧 token。
      const lastRetry = Date.parse(persisted.aiRetriedAt || '')
      const retryRecently = Number.isFinite(lastRetry) && Date.now() - lastRetry < 6 * 3600 * 1000
      if (!retryRecently) {
        g.topics = []
        g.stages = []
        g.relations = []
        g.relationsSignature = ''
        g.aiRetriedAt = nowIso()
        g.segmentedThroughTurn = 0
        g.topicSeq = 0
        g.stageSeq = 0
        g.lastAssignedTopicId = null
      }
    }
    g.ready = true
    g.loading = null
    g.aiStatus = 'idle'
    touchGraph(g)
    evictGraphsIfNeeded(state)
    for (const event of pending) {
      if (applyEvent(g, event)) g.version += 1
    }
    if (!restored && g.topics.length > 0) {
      // 持久化数据不可用：清空结构重新切分
      g.topics = []
      g.stages = []
      g.segmentedThroughTurn = 0
    }
    // 旧版本持久化没有关系签名：恢复后补一次「仅标题」关系分析（不阻塞首帧）
    if (restored && cfgRef.relationMode === 'titles' && !g.relationsSignature && g.topics.length >= 2) {
      void refineRelations(ctx, g).catch((error) => {
        g.relationError = describeLlmError(error)
        g.version += 1
      })
    }
    g.version += 1
    if (importError) g.aiError = `读取会话日志失败：${summarize(importError, 120)}`
    scheduleSegment(ctx, g, {})
    return g
  })()
  return g.loading
}

// ── 切分结构操作 ────────────────────────────────────────────────────────────

function createTopic(g, title) {
  g.topicSeq += 1
  const topic = {
    id: `t${g.topicSeq}`,
    title: summarize(title || '未命名话题', TOPIC_TITLE_MAX),
    summary: '',
    parentId: null,
    ownTurns: [],
    status: 'active',
    source: 'llm',
    stageId: null,
  }
  g.topics.push(topic)
  return topic
}

function createStage(g, title) {
  g.stageSeq += 1
  const stage = {
    id: `s${g.stageSeq}`,
    title: summarize(title || `阶段 ${g.stageSeq}`, STAGE_TITLE_MAX),
    summary: '',
    order: g.stages.length,
  }
  g.stages.push(stage)
  return stage
}

function topicsById(g) {
  return new Map(g.topics.map((t) => [t.id, t]))
}

/** 预建「父话题 id → 子话题数组」索引，避免 allTurnNums 每次都全表扫描。 */
function childrenIndex(g) {
  const children = new Map()
  for (const topic of g.topics) {
    if (!topic.parentId) continue
    if (!children.has(topic.parentId)) children.set(topic.parentId, [])
    children.get(topic.parentId).push(topic)
  }
  return children
}

function allTurnNums(g, topic, children) {
  const index = children || childrenIndex(g)
  const nums = new Set()
  const visit = (node, guard) => {
    if (!node || guard > 30) return
    for (const n of node.ownTurns || []) nums.add(n)
    for (const child of index.get(node.id) || []) visit(child, guard + 1)
  }
  visit(topic, 0)
  return [...nums].sort((a, b) => a - b)
}

function topicOwningTurn(g, turnNumber) {
  for (const topic of g.topics) {
    if ((topic.ownTurns || []).includes(turnNumber)) return topic
  }
  return null
}

function assignTurnToTopic(g, topic, turnNumber) {
  if (!topic) return
  for (const other of g.topics) {
    if (other === topic) continue
    const index = other.ownTurns.indexOf(turnNumber)
    if (index !== -1) other.ownTurns.splice(index, 1)
  }
  if (!topic.ownTurns.includes(turnNumber)) {
    topic.ownTurns.push(turnNumber)
    topic.ownTurns.sort((a, b) => a - b)
  }
  g.lastAssignedTopicId = topic.id
}

function lastTopicInOrder(g) {
  return g.topics.length ? g.topics[g.topics.length - 1] : null
}

const RELATION_LABEL_MAX = 8
const MAX_RELATIONS = 30

/** 解析 AI 输出的 relations，得到可落盘的 {from,to,label} 列表（只保留合法、去重、有向）。 */
function resolveRelations(g, rawRelations, tempToId, existingById) {
  const resolve = (ref) => {
    if (typeof ref !== 'string' || !ref) return null
    const id = tempToId.get(ref) || ref
    if (existingById.has(id)) return id
    return g.topics.some((t) => t.id === id) ? id : null
  }
  const out = []
  const seen = new Set()
  for (const raw of Array.isArray(rawRelations) ? rawRelations : []) {
    if (!raw || typeof raw !== 'object') continue
    const from = resolve(raw.from)
    const to = resolve(raw.to)
    if (!from || !to || from === to) continue
    const label = summarize(raw.label || '关联', RELATION_LABEL_MAX)
    const key = `${from}|${to}|${label}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ from, to, label })
    if (out.length >= MAX_RELATIONS) break
  }
  return out
}

/** 把 AI 输出的完整结构合入图状态；batch 内轮次重新归属，历史归属保持不变。 */
function applyAiStructure(g, parsed, batch) {
  const existingById = topicsById(g)
  const tempToId = new Map()
  const claims = new Map() // topicId -> { start, end }
  const outTopics = []
  const rawTopics = Array.isArray(parsed.topics) ? parsed.topics : []

  for (const raw of rawTopics) {
    if (!raw || typeof raw !== 'object') continue
    const rawId = typeof raw.id === 'string' ? raw.id : ''
    const tempId = typeof raw.tempId === 'string' ? raw.tempId : ''
    let topic = rawId ? existingById.get(rawId) : null
    if (!topic) {
      topic = createTopic(g, raw.title || raw.summary || '未命名话题')
      topic.source = 'llm'
    }
    if (rawId) tempToId.set(rawId, topic.id)
    if (tempId) tempToId.set(tempId, topic.id)
    const title = summarize(raw.title || topic.title, TOPIC_TITLE_MAX)
    if (title) topic.title = title
    if (typeof raw.summary === 'string' && raw.summary) topic.summary = summarize(raw.summary, SUMMARY_MAX)
    if (raw.status === 'active' || raw.status === 'done') topic.status = raw.status
    topic.source = 'llm'
    topic._parentRef = typeof raw.parentId === 'string' && raw.parentId ? raw.parentId : null
    const start = clampInt(raw.turnStart, 1, 1, 100000)
    const end = clampInt(raw.turnEnd, start, start, 100000)
    claims.set(topic.id, { start, end })
    outTopics.push(topic)
  }

  // 新话题 id 可能被父话题先引用 → 先统一注册到 g.topics 再解析
  for (const topic of outTopics) {
    if (!g.topics.includes(topic)) g.topics.push(topic)
  }
  for (const topic of outTopics) {
    const ref = topic._parentRef
    delete topic._parentRef
    if (!ref) { topic.parentId = null; continue }
    const resolved = tempToId.get(ref)
      || (existingById.has(ref) ? ref : null)
      || (g.topics.some((t) => t.id === ref) ? ref : null)
    topic.parentId = resolved && resolved !== topic.id ? resolved : null
  }
  // 父话题必须存在，且不允许成环
  for (const topic of g.topics) {
    if (!topic.parentId) continue
    if (!g.topics.some((t) => t.id === topic.parentId)) topic.parentId = null
  }
  for (const topic of g.topics) {
    let cursor = topic
    let guard = 0
    while (cursor.parentId && guard < 30) {
      const parent = g.topics.find((t) => t.id === cursor.parentId)
      if (!parent || parent === topic) { topic.parentId = null; break }
      cursor = parent
      guard += 1
    }
  }
  // 子话题最多 3 层（根话题为第 1 层）：超过的压平为根话题
  for (const topic of g.topics) {
    if (!topic.parentId) continue
    let level = 1
    let cursor = topic
    let guard = 0
    while (cursor.parentId && guard < 30) {
      const parent = g.topics.find((t) => t.id === cursor.parentId)
      if (!parent) break
      level += 1
      cursor = parent
      guard += 1
    }
    if (level > 3) topic.parentId = null
  }

  // 轮次归属：batch 内每个轮次取「覆盖它且最深」的话题；未覆盖则跟随前一轮
  const depthOf = (topic) => {
    let depth = 0
    let cursor = topic
    let guard = 0
    while (cursor?.parentId && guard < 30) {
      cursor = g.topics.find((t) => t.id === cursor.parentId)
      depth += 1
      guard += 1
    }
    return depth
  }
  let previousTopic = g.lastAssignedTopicId ? g.topics.find((t) => t.id === g.lastAssignedTopicId) : null
  for (const turn of batch.turns) {
    const candidates = outTopics.filter((topic) => {
      const claim = claims.get(topic.id)
      return claim && turn.turn >= claim.start && turn.turn <= claim.end
    })
    let target = null
    if (candidates.length) {
      candidates.sort((a, b) => {
        const depthDiff = depthOf(b) - depthOf(a)
        if (depthDiff !== 0) return depthDiff
        return (claims.get(b.id)?.start || 0) - (claims.get(a.id)?.start || 0)
      })
      target = candidates[0]
    } else if (previousTopic) {
      target = previousTopic
    } else {
      // 兜底：取结束轮次最接近且早于本轮的已有话题
      const past = g.topics
        .filter((topic) => {
          const claim = claims.get(topic.id)
          return claim && claim.end < turn.turn
        })
        .sort((a, b) => (claims.get(b.id)?.end || 0) - (claims.get(a.id)?.end || 0))
      target = past[0] || outTopics[0] || lastTopicInOrder(g)
    }
    if (!target) {
      target = createTopic(g, turn.prompt ? summarize(turn.prompt, 12) : `轮次 ${turn.turn}`)
      target.source = 'rule'
      target.stageId = g.stages.length ? g.stages[g.stages.length - 1].id : null
      outTopics.push(target)
    }
    assignTurnToTopic(g, target, turn.turn)
    previousTopic = target
  }

  // 最新一轮所在话题标为 active（其余保留模型判断），并清理没有任何轮次的话题
  const lastBatchTurnNo = batch.turns.length ? batch.turns[batch.turns.length - 1].turn : 0
  for (const topic of g.topics) {
    if ((topic.ownTurns || []).includes(lastBatchTurnNo)) topic.status = 'active'
  }
  g.topics = g.topics.filter((topic) => allTurnNums(g, topic).length > 0)
  // 被清掉的话题若曾作为父话题，子话题提升为根话题
  for (const topic of g.topics) {
    if (topic.parentId && !g.topics.some((t) => t.id === topic.parentId)) topic.parentId = null
  }

  // 关系边：保留旧关系（两端话题仍存在），合并本次 AI 输出的新关系
  {
    const live = new Set(g.topics.map((t) => t.id))
    const kept = (Array.isArray(g.relations) ? g.relations : []).filter((rel) => live.has(rel.from) && live.has(rel.to))
    const added = resolveRelations(g, parsed.relations, tempToId, existingById)
    const byKey = new Map()
    for (const rel of kept) byKey.set(`${rel.from}|${rel.to}|${rel.label}`, rel)
    for (const rel of added) byKey.set(`${rel.from}|${rel.to}|${rel.label}`, rel)
    g.relations = [...byKey.values()].slice(0, MAX_RELATIONS)
  }

  // 阶段：合并 AI 输出（保留已有阶段 id/顺序），把根话题按 topicRefs 归入
  const refsToStage = new Map() // topicId -> stageId
  const outStages = []
  const existingStages = g.stages.slice()
  const resolveTopicRef = (ref) => {
    if (typeof ref !== 'string') return null
    const id = tempToId.get(ref) || ref
    let topic = g.topics.find((t) => t.id === id)
    if (!topic) return null
    let guard = 0
    while (topic.parentId && guard < 30) {
      const parent = g.topics.find((t) => t.id === topic.parentId)
      if (!parent) break
      topic = parent
      guard += 1
    }
    return topic.id
  }
  const rawStages = Array.isArray(parsed.stages) ? parsed.stages : []
  for (const raw of rawStages) {
    if (!raw || typeof raw !== 'object') continue
    const rawId = typeof raw.id === 'string' ? raw.id : ''
    const tempId = typeof raw.tempId === 'string' ? raw.tempId : ''
    void tempId
    let stage = rawId ? existingStages.find((s) => s.id === rawId) : null
    if (!stage) stage = createStage(g, raw.title || `阶段 ${g.stages.length + 1}`)
    const title = summarize(raw.title || stage.title, STAGE_TITLE_MAX)
    if (title) stage.title = title
    if (typeof raw.summary === 'string' && raw.summary) stage.summary = summarize(raw.summary, SUMMARY_MAX)
    stage.order = outStages.length
    outStages.push(stage)
    const refs = Array.isArray(raw.topicRefs) ? raw.topicRefs : []
    for (const ref of refs) {
      const topicId = resolveTopicRef(ref)
      if (topicId) refsToStage.set(topicId, stage.id)
    }
  }

  // 未被输出的已有阶段：若仍有话题则保留
  for (const stage of existingStages) {
    if (outStages.includes(stage)) continue
    const hasTopics = g.topics.some((t) => t.parentId == null && t.stageId === stage.id)
    if (hasTopics) {
      stage.order = outStages.length
      outStages.push(stage)
    }
  }
  if (!outStages.length) {
    if (existingStages.length) outStages.push(...existingStages)
    else outStages.push(createStage(g, '初始阶段'))
  }
  g.stages = outStages

  // 根话题：显式引用优先；否则沿用旧归属；再否则放入最后一个阶段
  const rootTopics = g.topics.filter((t) => t.parentId == null)
  for (const topic of rootTopics) {
    const stageId = refsToStage.get(topic.id)
    if (stageId) topic.stageId = stageId
  }
  for (const topic of rootTopics) {
    if (!topic.stageId || !g.stages.some((s) => s.id === topic.stageId)) {
      topic.stageId = g.stages[g.stages.length - 1].id
    }
  }
  // 子话题跟随父话题的阶段
  for (const topic of g.topics) {
    if (!topic.parentId) continue
    const parent = g.topics.find((t) => t.id === topic.parentId)
    topic.stageId = parent?.stageId || g.stages[g.stages.length - 1].id
  }
  // 清理没有任何根话题的空阶段（至少保留一个阶段，作为后续新话题的兜底归属）
  const nonEmptyStages = g.stages.filter((stage) => g.topics.some((t) => t.parentId == null && t.stageId === stage.id))
  if (nonEmptyStages.length) {
    g.stages = nonEmptyStages
    nonEmptyStages.forEach((stage, index) => { stage.order = index })
  } else if (!g.stages.length) {
    g.stages = [createStage(g, '初始阶段')]
  }
}

function titleFromPrompt(prompt, turn) {
  const cleaned = summarize(prompt || '', 16)
  return cleaned || `轮次 ${turn}`
}

/** 规则兜底（无 AI / AI 不可用）：按轮次数量分组，保证界面始终可用。 */
function applyRuleStructure(g, batch) {
  let currentStage = g.stages.length ? g.stages[g.stages.length - 1] : createStage(g, '阶段 1')
  for (const turn of batch.turns) {
    let current = null
    const last = lastTopicInOrder(g)
    if (last && last.parentId == null && last.ownTurns.length > 0
      && last.ownTurns.length < cfgRef.ruleTurnsPerTopic
      && last.status === 'active') {
      current = last
    }
    if (!current) {
      const stageRootCount = g.topics.filter((t) => t.parentId == null && t.stageId === currentStage.id).length
      if (stageRootCount >= cfgRef.ruleTopicsPerStage) {
        currentStage = createStage(g, `阶段 ${g.stages.length + 1}`)
      }
      current = createTopic(g, titleFromPrompt(turn.prompt, turn.turn))
      current.source = 'rule'
      current.summary = summarize(turn.prompt || '', SUMMARY_MAX)
      current.stageId = currentStage.id
    }
    assignTurnToTopic(g, current, turn.turn)
    current.status = 'active'
    for (const other of g.topics) if (other !== current) other.status = 'done'
  }
  if (!g.stages.length) g.stages.push(currentStage)
}

/** 增量兜底：扩展上一轮所属话题，不再重排历史。 */
function applyExtendFallback(g, batch) {
  if (!g.topics.length) {
    applyRuleStructure(g, batch)
    return
  }
  let target = topicOwningTurn(g, batch.turns[0].turn - 1) || lastTopicInOrder(g)
  for (const turn of batch.turns) {
    if (!target) {
      applyRuleStructure(g, { turns: [turn] })
      target = topicOwningTurn(g, turn.turn)
      continue
    }
    assignTurnToTopic(g, target, turn.turn)
    if (!target.summary && turn.prompt) target.summary = summarize(turn.prompt, SUMMARY_MAX)
    target.status = 'active'
  }
  for (const topic of g.topics) {
    if (target && topic === target) continue
    topic.status = 'done'
  }
  // 保证阶段归属存在
  if (!g.stages.length) createStage(g, '初始阶段')
  for (const topic of g.topics) {
    if (!topic.parentId && (!topic.stageId || !g.stages.some((s) => s.id === topic.stageId))) {
      topic.stageId = g.stages[g.stages.length - 1].id
    }
  }
}

// ── 增量切分调度 ────────────────────────────────────────────────────────────

function lastSettledTurn(g) {
  let last = 0
  for (const turn of g.turns) {
    if (turn.status === 'open') continue
    if (turn.turn > last) last = turn.turn
  }
  return last
}

function collectBatch(g, limitTurn) {
  const turns = []
  let chars = 0
  for (const turn of g.turns) {
    if (turn.turn <= g.segmentedThroughTurn) continue
    if (turn.turn > limitTurn) break
    if (turn.status === 'open') break
    const line = renderTurnLine(turn)
    if (turns.length >= cfgRef.batchTurns) break
    if (turns.length > 0 && chars + line.length > cfgRef.maxInputChars) break
    turns.push({ turn, line })
    chars += line.length
  }
  return { turns: turns.map((item) => item.turn), lines: turns.map((item) => item.line) }
}

function buildSegmentInput(g, batch) {
  const existing = renderExistingStructure(g)
  const head = g.turns.length ? `【会话轮次总数】${g.turns.length}` : ''
  const parts = []
  if (head) parts.push(head)
  if (existing) parts.push(existing)
  const links = Array.isArray(g.subagentLinks) ? g.subagentLinks : []
  if (links.length) {
    parts.push('【该会话启动的子智能体（它们的完整内容单独切分，这里只用于判断哪些轮次在委托任务，可作为话题归属线索）】')
    for (const link of links) {
      parts.push(`- 子会话 ${link.sessionId} "${link.title || '子智能体'}" 从轮${link.parentTurn ?? '?'} 启动，共 ${link.turnCount || 0} 轮`)
    }
  }
  parts.push(`【需要归属的新轮次（共 ${batch.turns.length} 轮）】`)
  parts.push(batch.lines.join('\n'))
  parts.push('')
  parts.push(g.topics.length
    ? '请基于已有话题/阶段结构，判断这些新轮次的归属（并入已有话题 / 新建话题 / 新建子话题），必要时更新阶段划分，并输出更新后的完整结构 JSON。'
    : '这是会话最开始的若干轮，请从零建立话题与阶段结构，输出 JSON。')
  return parts.join('\n')
}

/** 单次切分请求可能过长：分批（batchTurns）之外，再按内容长度做二次截断。 */
function trimBatchForRequest(batch) {
  const maxChars = cfgRef.maxInputChars
  if (!maxChars) return batch
  const turns = []
  const lines = []
  let chars = 0
  for (let i = 0; i < batch.turns.length; i += 1) {
    const line = batch.lines[i] || ''
    if (turns.length > 0 && chars + line.length > maxChars) break
    turns.push(batch.turns[i])
    lines.push(line)
    chars += line.length
  }
  return turns.length ? { turns, lines } : batch
}

/** 判断模型输出是否完整（截断的输出即使能修复也不应当作成功应用）。 */
function looksCompleteJsonText(raw) {
  let text = String(raw || '').trim()
  if (!text) return false
  const fenced = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)]
  if (fenced.length) text = fenced[fenced.length - 1][1].trim()
  text = text.replace(/```$/g, '').trim()
  return text.endsWith('}')
}

/** 输出上限：要输出「全部已有话题 + 阶段 + 关系」，话题越多输出越长。 */
function segmentMaxTokens(g) {
  const topics = Array.isArray(g.topics) ? g.topics.length : 0
  const stages = Array.isArray(g.stages) ? g.stages.length : 0
  return clampInt(4096 + topics * 90 + stages * 60, 4096, 4096, 16384)
}

async function askLlmSegment(ctx, g, batch) {
  const input = buildSegmentInput(g, trimBatchForRequest(batch))
  let maxTokens = segmentMaxTokens(g)
  let effort // undefined = 使用配置档位；null = 适配器默认档位
  let lastError = null
  let parseRetried = false
  let effortRetried = false
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const result = await llmText(ctx, cfgRef, SEGMENT_SYSTEM_PROMPT, input, maxTokens, effort)
      g.llmProvider = result.provider
      g.llmModel = result.model
      accumulateAiUsage(g, result.usage)
      g.aiCalls += 1
      const parsed = parseGraphJson(result.text)
      const complete = parsed ? looksCompleteJsonText(result.text) : false
      if (parsed && complete) return parsed
      // 大输出重试之后仍然被截断：能修复出结构就尽量挽救，避免整段退回规则
      if (parsed && !complete && parseRetried) return parsed
      const error = new Error('模型输出不是合法的图谱 JSON')
      error.code = 'PARSE_OUTPUT'
      throw error
    } catch (error) {
      lastError = error
      // 输出被截断 → 保持批次不变，放大输出上限重试（缩批不能解决输出长度问题）
      if (error && error.code === 'PARSE_OUTPUT') {
        if (!parseRetried && maxTokens < 16000) {
          parseRetried = true
          maxTokens = Math.min(16000, maxTokens * 2)
          continue
        }
        break
      }
      // 400 / INVALID_REQUEST → 换适配器默认推理档位再试一次
      if (!effortRetried && shouldRetryWithDefaultEffort(error)) {
        effortRetried = true
        effort = null
        continue
      }
      break
    }
  }
  throw lastError || new Error('AI 请求失败')
}

// ── 仅按标题判断话题关联（含 A→B→A 回访） ───────────────────────────────

const RELATION_SYSTEM_PROMPT = [
  '你是「话题关系分析器」。给定一个会话里按时间顺序排列的话题（标题、轮次、阶段、父子关系、摘要），判断话题之间的语义联系。',
  '重点关注：',
  '1. 回访：先说 A，中间说 B，后来又回到 A（输出 from=先说的 A，to=后说的 A，label=回访）。',
  '2. 延展：先说 A，后又说 A 内部的子问题 A1、A2（输出 from=A，to=A1/A2，label=延展）。',
  '3. 依赖 / 延续 / 对比 / 修复 / 验证 / 补充 / 同一目标 等有意义的关系。',
  '4. 只依据标题与摘要判断，不要臆测细枝末节；没有明确联系的不要输出。',
  '5. 只使用给定的话题 id，输出有向边；尽量让每个话题平均有 1~2 条关系边（不含相邻 next），重复的合并。',
  '只输出纯 JSON，禁止 markdown 代码块与解释。格式：',
  '{"relations":[{"from":"话题id","to":"另一话题id","label":"2~6字关系词"}]}',
  '没有关系时输出 {"relations":[]}。',
].join('\n')

/** 只根据话题标题判断关联；签名未变化时跳过，避免重复烧 token。 */
async function refineRelations(ctx, g) {
  if (cfgRef.relationMode !== 'titles' || cfgRef.segmentMode === 'rule') return
  const topics = g.topics
  if (topics.length < 2) {
    if (g.relations.length) {
      g.relations = []
      g.relationsSignature = ''
      g.version += 1
      scheduleSave(g)
    }
    return
  }
  const signature = topics.map((topic) => `${topic.id}:${topic.title}`).join('|')
  if (g.relationsSignature === signature) return
  const stageTitle = new Map(g.stages.map((stage) => [stage.id, stage.title]))
  const byId = topicsById(g)
  const cap = Math.max(24, Math.min(300, Math.ceil(topics.length * 1.5)))
  const lines = topics.map((topic) => {
    const range = topic.ownTurns.length
      ? `轮${topic.ownTurns[0]}-${topic.ownTurns[topic.ownTurns.length - 1]}`
      : '无轮次'
    const parent = topic.parentId ? byId.get(topic.parentId) : null
    const kind = parent ? ` 子话题(父:${parent.title})` : ''
    const summary = topic.summary ? ` 摘要:${summarize(topic.summary, 40)}` : ''
    return `${topic.id} "${topic.title}" ${range} 阶段:${stageTitle.get(topic.stageId) || '?'}${kind}${summary}`
  })
  const listText = `【话题列表（按时间顺序；共 ${topics.length} 个）】\n${lines.join('\n')}`
  const live = new Set(topics.map((topic) => topic.id))
  const parseOut = (text) => {
    const parsed = parseGraphJson(text)
    if (!parsed || !Array.isArray(parsed.relations)) return null
    const list = []
    const seen = new Set()
    for (const raw of parsed.relations) {
      if (!raw || typeof raw !== 'object') continue
      const from = typeof raw.from === 'string' ? raw.from : ''
      const to = typeof raw.to === 'string' ? raw.to : ''
      if (!live.has(from) || !live.has(to) || from === to) continue
      const key = `${from}>${to}`
      if (seen.has(key)) continue
      seen.add(key)
      list.push({ from, to, label: summarize(raw.label || '关联', 8) })
      if (list.length >= cap) break
    }
    return list
  }

  const result = await llmText(
    ctx,
    cfgRef,
    RELATION_SYSTEM_PROMPT,
    `${listText}\n\n请输出关系边；最多 ${cap} 条。`,
    Math.min(4000, 400 + topics.length * 30),
    'off',
  )
  accumulateAiUsage(g, result.usage)
  g.aiCalls += 1
  const out = parseOut(result.text)
  if (!out) throw new Error('模型输出不是合法的关系 JSON')

  // 合并切分阶段已有的关系（而不是覆盖）
  const existing = (g.relations || []).filter((rel) => live.has(rel.from) && live.has(rel.to))
  let merged = mergeRelations(existing, out).slice(0, cap)

  // 二次补偿：对没有任何关系边的孤立话题再跑一次（只接受涉及它们的边）
  try {
    const linked = new Set()
    for (const rel of merged) { linked.add(rel.from); linked.add(rel.to) }
    const orphans = topics.filter((topic) => !linked.has(topic.id))
    if (orphans.length && orphans.length < topics.length && topics.length <= 100) {
      const orphanIds = orphans.map((topic) => topic.id).join(', ')
      const result2 = await llmText(
        ctx,
        cfgRef,
        RELATION_SYSTEM_PROMPT,
        `${listText}\n\n以上话题中，以下这些目前没有任何关系边：${orphanIds}。\n请只判断它们与其他话题之间是否存在关系（回访 / 延展 / 依赖 / 延续 / 修复 / 验证 等），输出有向边；最多 ${cap} 条。`,
        Math.min(4000, 400 + topics.length * 30),
        'off',
      )
      accumulateAiUsage(g, result2.usage)
      g.aiCalls += 1
      const extra = parseOut(result2.text)
      if (extra && extra.length) {
        const keys = new Set()
        for (const rel of existing) keys.add(`${rel.from}>${rel.to}`)
        for (const rel of out) keys.add(`${rel.from}>${rel.to}`)
        const additions = extra.filter((rel) => !keys.has(`${rel.from}>${rel.to}`))
        merged = mergeRelations(merged, additions).slice(0, cap)
      }
    }
  } catch (error) {
    // 二次补偿失败不影响主结果
  }

  g.relations = merged
  g.relationsSignature = signature
  g.relationError = ''
  g.version += 1
  g.updatedAt = nowIso()
  scheduleSave(g)
}

// ── 单轮 AI 分析（how-to） ────────────────────────────────────────────────

const TURN_ANALYSIS_SYSTEM_PROMPT = [
  '你是「技术写作助手」。下面给出某一轮对话里模型的执行轨迹（按时间顺序的模型输出与工具调用）。',
  '请用通俗、面向人的语言，把这一轮「实际做了什么」写成一份分步骤说明（how-to）。',
  '要求：',
  '1. 只描述这一轮之内发生的事，不要扩展到其它轮次；',
  '2. 以「模型输出」和「工具调用」为基本单元，扁平 1~2 层，最多 8 步；',
  '3. 每步先用一句话说“做了什么”，再补一句目的或结果，尽量不用术语；',
  '4. 工具名、参数点到为止，重点是“为了什么、得到什么”；',
  '5. 每个步骤额外标注 stepCount：该步骤覆盖了多少个执行单元（整数，即轨迹里模型输出/工具调用的条数），所有步骤的 stepCount 合计应约等于轨迹单元总数。',
  '只输出纯 JSON，禁止 markdown 代码块与任何解释，格式：',
  '{"steps":[{"title":"步骤标题","detail":"通俗说明","tools":["工具名"],"outcome":"这一步的结果/产出","stepCount":2}]}',
].join('\n')

/** 解析单轮分析 JSON：只认含 steps 数组的对象。 */
function parseTurnAnalysisJson(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidates = fenced && fenced[1] ? [fenced[1], raw] : [raw]
  for (const candidate of candidates) {
    const start = candidate.indexOf('{')
    const end = candidate.lastIndexOf('}')
    if (start === -1 || end <= start) continue
    try {
      const parsed = JSON.parse(candidate.slice(start, end + 1))
      if (parsed && Array.isArray(parsed.steps)) return parsed
    } catch { /* try next */ }
  }
  return null
}

/** 按需重建轨迹 → AI 生成分步说明 → 持久化缓存（签名未变时不重跑）。 */
async function analyzeTurn(ctx, sessionId, turnNumber, opts = {}) {
  const g = await ensureGraph(ctx, sessionId)
  if (!g.ready) throw new Error('会话尚未就绪')
  const turn = g.turnIndex.get(turnNumber)
  if (!turn) throw new Error('轮次不存在')
  if (turn.status === 'open' || turn.endSeq == null) throw new Error('轮次尚未结束，暂不支持分析')
  const signature = `${turn.endSeq}:${turn.toolCalls.total}:${turn.requests}`
  g.turnAnalyses = g.turnAnalyses || {}
  const cached = g.turnAnalyses[turnNumber]
  if (!opts.force && cached && cached.signature === signature && Array.isArray(cached.steps) && cached.steps.length) {
    return cached
  }
  // 按需从日志重建轨迹，用完即弃（不驻留内存）
  const snapshot = await readSessionEvents(ctx, g.sessionId || sessionId)
  const trace = buildTurnTrace(snapshot ? snapshot.events : [], turnNumber)
  if (!trace.length) throw new Error('该轮次没有可分析的轨迹')
  const input = `【轮次】第 ${turnNumber} 轮\n【轨迹单元总数】${trace.length}\n【轨迹】\n${renderTurnTrace(trace)}`
  const result = await llmText(ctx, cfgRef, TURN_ANALYSIS_SYSTEM_PROMPT, input, 2000, 'off')
  accumulateAiUsage(g, result.usage)
  g.aiCalls += 1
  const parsed = parseTurnAnalysisJson(result.text)
  const steps = (Array.isArray(parsed && parsed.steps) ? parsed.steps : [])
    .filter((step) => step && typeof step === 'object')
    .map((step) => ({
      title: summarize(String(step.title || step.step || ''), 60) || '步骤',
      detail: summarize(String(step.detail || step.explain || step.how || ''), 300),
      tools: Array.isArray(step.tools) ? step.tools.slice(0, 12).map((x) => String(x)) : [],
      outcome: summarize(String(step.outcome || step.result || ''), 200),
      stepCount: clampInt(step.stepCount != null ? step.stepCount : step.toolCalls, 1, 0, 999),
    }))
    .slice(0, TURN_ANALYSIS_STEPS_MAX)
  if (!steps.length) {
    const error = new Error('AI 未生成有效的分步说明')
    error.code = 'PARSE_OUTPUT'
    throw error
  }
  const analysis = { steps, signature, generatedAt: nowIso() }
  g.turnAnalyses[turnNumber] = analysis
  g.version += 1
  scheduleSave(g)
  return analysis
}

async function runSegment(ctx, g, opts = {}) {
  if (!g.ready) return
  if (g.segRunning) {
    g.segQueued = true
    g.segQueuedFull = g.segQueuedFull || Boolean(opts.full)
    return
  }
  g.segRunning = true
  g.aiStatus = 'running'
  g.aiError = ''
  g.relationError = ''
  g.lastAiAt = nowIso()
  // 把子智能体信息暴露给切分提示词（子会话内容单独切分，这里只做委托归属线索）
  try {
    g.subagentLinks = collectDescendants(g.key, 1).map((item) => {
      const child = stateOf().graphs.get(item.key)
      return {
        sessionId: item.id,
        title: stateOf().titleCache.get(item.key)?.title || item.meta.title || '',
        parentTurn: findParentTurnForTime(g, item.meta.createdAt),
        turnCount: child && child.ready ? child.turns.length : 0,
      }
    })
  } catch { g.subagentLinks = [] }
  g.aiMode = cfgRef.segmentMode
  g.version += 1
  if (opts.full) {
    g.topics = []
    g.stages = []
    g.relations = []
    g.relationsSignature = ''
    g.segBatchLimit = cfgRef.batchTurns
    g.segmentedThroughTurn = 0
    g.topicSeq = 0
    g.stageSeq = 0
    g.lastAssignedTopicId = null
  }
  try {
    let guard = 0
    // 连续失败的批次数：达到 2 后本会话先降级为规则/扩展切分，避免反复 400 烧钱
    let consecutiveFailures = 0
    while (guard < 120) {
      guard += 1
      const settled = lastSettledTurn(g)
      if (settled <= g.segmentedThroughTurn) break
      const fullBatch = collectBatch(g, settled)
      if (!fullBatch.turns.length) break
      let batch = fullBatch
      let applied = false
      if (cfgRef.segmentMode !== 'rule' && consecutiveFailures < 2) {
        // 自适应拆分：请求失败时把本批轮次减半重试，直到单轮；单轮仍失败才回退。
        // 记住「最近一次成功/收敛的批次大小」，下一批直接用它，避免每次都先撞一次 400。
        const knownLimit = Math.max(1, Number(g.segBatchLimit) || cfgRef.batchTurns)
        let size = Math.min(fullBatch.turns.length, knownLimit)
        let tries = 0
        while (true) {
          tries += 1
          const sub = {
            turns: fullBatch.turns.slice(0, size),
            lines: fullBatch.lines.slice(0, size),
          }
          try {
            const parsed = await askLlmSegment(ctx, g, sub)
            applyAiStructure(g, parsed, sub)
            applied = true
            batch = sub
            g.aiError = ''
            consecutiveFailures = 0
            g.segBatchLimit = Math.max(1, Math.min(knownLimit, size))
            break
          } catch (error) {
            batch = sub
            g.aiError = describeLlmError(error)
            // 输出解析失败与批次大小无关：不浪费时间逐级缩批，直接回退本批并降级后续
            if (error && error.code === 'PARSE_OUTPUT') {
              consecutiveFailures += 1
              break
            }
            if (size <= 1 || tries >= 3) {
              consecutiveFailures += 1
              break
            }
            size = Math.max(1, Math.floor(size / 2))
            g.segBatchLimit = size
          }
        }
      }
      if (!applied) {
        applyExtendFallback(g, batch)
        consecutiveFailures = Math.max(consecutiveFailures, 1)
      }
      g.segmentedThroughTurn = batch.turns[batch.turns.length - 1].turn
      g.aiProgress = settled > 0 ? Math.min(1, g.segmentedThroughTurn / settled) : 0
      g.updatedAt = nowIso()
      g.lastSegAt = Date.now()
      g.version += 1
      scheduleSave(g)
    }
    // 批次上限耗尽仍未切完：显式记录，避免静默停在半途
    if (lastSettledTurn(g) > g.segmentedThroughTurn && guard >= 120) {
      g.aiError = `切分批次超过上限（120）后暂停：已切 ${g.segmentedThroughTurn}/${lastSettledTurn(g)} 轮`
      g.aiProgress = lastSettledTurn(g) > 0 ? g.segmentedThroughTurn / lastSettledTurn(g) : 0
    }
    // 结构稳定后，再单独用「标题」做一次轻量关系分析（含 A→B→A 回访）
    if (cfgRef.segmentMode !== 'rule') {
      try {
        await refineRelations(ctx, g)
      } catch (error) {
        g.relationError = describeLlmError(error)
      }
    }
    g.aiStatus = g.aiError ? 'error' : 'idle'
  } catch (error) {
    g.aiStatus = 'error'
    g.aiError = describeLlmError(error)
  } finally {
    g.segRunning = false
    g.version += 1
    g.updatedAt = g.updatedAt || nowIso()
    scheduleSave(g)
    if (g.segQueued) {
      const full = g.segQueuedFull
      g.segQueued = false
      g.segQueuedFull = false
      scheduleSegment(ctx, g, { full })
    }
  }
}

function scheduleSegment(ctx, g, opts = {}) {
  if (!g.ready) return
  if (!cfgRef.autoSegment && !opts.full && !opts.force) return
  if (g.segRunning) {
    g.segQueued = true
    g.segQueuedFull = g.segQueuedFull || Boolean(opts.full)
    return
  }
  if (lastSettledTurn(g) <= g.segmentedThroughTurn && !opts.full) return
  clearTimeout(g.segmentTimer)
  const sinceLast = Date.now() - (g.lastSegAt || 0)
  const wait = Math.max(cfgRef.debounceMs, cfgRef.minGapMs - sinceLast, 0)
  g.segmentTimer = setTimeout(() => {
    g.segmentTimer = null
    void runSegment(ctx, g, { full: Boolean(opts.full) })
  }, wait)
}

// ── 持久化 ──────────────────────────────────────────────────────────────────

function dataRoot() {
  const home = process.env.DSH_HOME || join(os.homedir(), '.dsh')
  return join(home, 'data', DATA_DIR_NAME)
}

function graphFile(g) {
  return join(dataRoot(), `${g.key}.json`)
}

function modelFile() {
  return join(dataRoot(), MODEL_FILE)
}

async function loadModelOverride() {
  try {
    const raw = await readFile(modelFile(), 'utf8')
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed.provider === 'string' && typeof parsed.model === 'string') {
      cfgRef.provider = parsed.provider
      cfgRef.model = parsed.model
    }
  } catch { /* 无覆盖文件或非法：保持 config 默认 */ }
}

async function saveModelOverride(provider, model) {
  await mkdir(dataRoot(), { recursive: true })
  const file = modelFile()
  const tmp = `${file}.tmp`
  await writeFile(tmp, JSON.stringify({ provider, model }), 'utf8')
  await rename(tmp, file)
}

function serializeGraph(g) {
  return {
    v: 1,
    sessionId: g.sessionId,
    updatedAt: g.updatedAt || nowIso(),
    segmentedThroughTurn: g.segmentedThroughTurn,
    aiGenerated: g.topics.some((topic) => topic.source === 'llm'),
    aiError: g.aiError || '',
    aiRetriedAt: g.aiRetriedAt || '',
    aiTokens: g.aiTokens || emptyTokens(),
    aiCalls: g.aiCalls || 0,
    turnAnalyses: g.turnAnalyses || {},
    topics: g.topics.map((t) => ({
      id: t.id,
      title: t.title,
      summary: t.summary,
      parentId: t.parentId,
      ownTurns: t.ownTurns,
      status: t.status,
      source: t.source,
      stageId: t.stageId,
    })),
    stages: g.stages.map((s) => ({ id: s.id, title: s.title, summary: s.summary, order: s.order })),
    relations: (g.relations || []).map((r) => ({ from: r.from, to: r.to, label: r.label })),
    relationsSignature: g.relationsSignature || '',
  }
}

function scheduleSave(g) {
  clearTimeout(g.saveTimer)
  g.saveTimer = setTimeout(() => {
    g.saveTimer = null
    void saveGraphNow(g)
  }, SAVE_DEBOUNCE_MS)
}

async function saveGraphNow(g) {
  try {
    const dir = dataRoot()
    await mkdir(dir, { recursive: true })
    const file = graphFile(g)
    const tmp = `${file}.tmp`
    await writeFile(tmp, JSON.stringify(serializeGraph(g)), 'utf8')
    await rename(tmp, file)
    stateOf().segmentKeys.add(g.key)
  } catch {
    // 持久化失败不影响内存视图
  }
}

// ── 聚合 / 序列化响应 ───────────────────────────────────────────────────────

function emptyAggregate() {
  return {
    turnCount: 0,
    tokens: emptyTokens(),
    toolCalls: { total: 0, byName: {} },
    wallMs: 0,
    agentMs: 0,
    requests: 0,
    toolErrors: 0,
  }
}

function addTurnToAggregate(agg, turn) {
  agg.turnCount += 1
  const tokens = turn.tokens
  for (const key of Object.keys(agg.tokens)) agg.tokens[key] += numOr0(tokens[key])
  agg.toolCalls.total += turn.toolCalls.total
  for (const [toolName, count] of Object.entries(turn.toolCalls.byName)) {
    agg.toolCalls.byName[toolName] = (agg.toolCalls.byName[toolName] || 0) + count
  }
  agg.wallMs += Math.max(0, (turn.endTime || 0) - (turn.startTime || 0))
  agg.agentMs += Math.max(0, turn.agentMs || 0)
  agg.requests += turn.requests
  agg.toolErrors += turn.toolErrors
}

function ratio(value, total) {
  if (!total) return 0
  return Math.round((value / total) * 10000) / 10000
}

function turnWallMs(turn) {
  const end = turn.status === 'open' ? Math.max(turn.endTime || 0, turn.lastTime || 0) : (turn.endTime || 0)
  return Math.max(0, end - (turn.startTime || 0))
}

/** 统计视图：把聚合量换算成占比。 */
function statsView(agg, totalAgg) {
  return {
    turnCount: agg.turnCount,
    tokens: agg.tokens,
    tokenRatio: ratio(agg.tokens.total, totalAgg.tokens.total),
    toolCalls: agg.toolCalls,
    toolRatio: ratio(agg.toolCalls.total, totalAgg.toolCalls.total),
    wallMs: agg.wallMs,
    wallRatio: ratio(agg.wallMs, totalAgg.wallMs),
    agentMs: agg.agentMs,
    agentRatio: ratio(agg.agentMs, totalAgg.agentMs),
  }
}

function topicTurnRange(g, topic, children) {
  const nums = allTurnNums(g, topic, children)
  return nums.length ? { start: nums[0], end: nums[nums.length - 1], count: nums.length } : { start: null, end: null, count: 0 }
}

/** 话题的 ownTurns 最早轮次（用于排序）。 */
function minOwnTurn(topic) {
  return Array.isArray(topic.ownTurns) && topic.ownTurns.length ? topic.ownTurns[0] : Infinity
}

/** 构建话题 / 阶段 / 轮次三类统计（不含 Edge / 子智能体）。 */
function computeGraphStats(g, turns) {
  const totalAgg = emptyAggregate()
  for (const turn of turns) addTurnToAggregate(totalAgg, turn)

  const children = childrenIndex(g)
  const topicAgg = new Map()
  for (const topic of g.topics) {
    const agg = emptyAggregate()
    for (const n of allTurnNums(g, topic, children)) {
      const turn = g.turnIndex.get(n)
      if (turn) addTurnToAggregate(agg, turn)
    }
    topicAgg.set(topic.id, agg)
  }
  const stageAgg = new Map()
  for (const stage of g.stages) {
    const agg = emptyAggregate()
    for (const topic of g.topics) {
      if (topic.parentId != null || topic.stageId !== stage.id) continue
      for (const n of allTurnNums(g, topic, children)) {
        const turn = g.turnIndex.get(n)
        if (turn) addTurnToAggregate(agg, turn)
      }
    }
    stageAgg.set(stage.id, agg)
  }
  return { totalAgg, topicAgg, stageAgg }
}

/** 每条话题链（next）、阶段 / 父话题归属（belongTo）、AI 关系（has_relation）、子智能体委托（delegates）。 */
/** 标题相似度（字符二元组 Dice 系数），用于确定性识别「回访」。 */
function titleSimilarity(a, b) {
  const norm = (value) => String(value || '').replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase()
  const x = norm(a)
  const y = norm(b)
  if (!x || !y) return 0
  if (x === y) return 1
  const grams = (value) => {
    const set = new Set()
    for (let i = 0; i < value.length - 1; i += 1) set.add(value.slice(i, i + 2))
    return set
  }
  const gx = grams(x)
  const gy = grams(y)
  if (!gx.size || !gy.size) return 0
  let inter = 0
  for (const gram of gx) if (gy.has(gram)) inter += 1
  return (2 * inter) / (gx.size + gy.size)
}

const REVISIT_TITLE_THRESHOLD = 0.7

/** 确定性「回访」边：标题高度相似、但被切成两个话题时兜底补一条（AI 可能漏判）。 */
function deriveRevisitRelations(g) {
  const ordered = g.topics.slice().sort((a, b) => minOwnTurn(a) - minOwnTurn(b))
  const existing = new Set()
  for (const rel of g.relations || []) {
    existing.add(`${rel.from}>${rel.to}`)
    existing.add(`${rel.to}>${rel.from}`)
  }
  const out = []
  for (let i = 0; i < ordered.length && out.length < 12; i += 1) {
    for (let j = i + 1; j < ordered.length && out.length < 12; j += 1) {
      const a = ordered[i]
      const b = ordered[j]
      if (a.parentId === b.id || b.parentId === a.id) continue
      if (existing.has(`${a.id}>${b.id}`)) continue
      if (titleSimilarity(a.title, b.title) < REVISIT_TITLE_THRESHOLD) continue
      out.push({ from: a.id, to: b.id, label: '回访' })
      existing.add(`${a.id}>${b.id}`)
    }
  }
  return out
}

/** 确定性「延展」边：父话题 -> 它的每个子话题（和层级 belongTo 并存，用于时间线/结构图展示）。 */
function deriveExtensionRelations(g) {
  const byId = topicsById(g)
  const out = []
  for (const topic of g.topics) {
    if (topic.parentId == null) continue
    const parent = byId.get(topic.parentId)
    if (!parent) continue
    out.push({ from: parent.id, to: topic.id, label: '延展', kind: 'extension' })
  }
  return out
}

/** 合并 AI 关系与确定性回访边（去重、保序）。 */
function mergeRelations(base, extra) {
  const merged = []
  const seen = new Set()
  for (const rel of [...(base || []), ...(extra || [])]) {
    const key = `${rel.from}>${rel.to}:${rel.label}`
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(rel)
  }
  return merged
}

function buildEdges(g, branches, relations) {
  const edges = []
  const roots = g.topics.filter((topic) => topic.parentId == null)
  const ordered = roots.slice().sort((a, b) => minOwnTurn(a) - minOwnTurn(b))
  for (let i = 0; i < ordered.length - 1; i += 1) {
    edges.push({
      id: `next:${ordered[i].id}>${ordered[i + 1].id}`,
      type: 'next',
      from: ordered[i].id,
      to: ordered[i + 1].id,
    })
  }
  for (const topic of roots) {
    if (!topic.stageId) continue
    edges.push({ id: `belong:${topic.id}`, type: 'belongTo', kind: 'stage', from: topic.id, to: topic.stageId })
  }
  for (const topic of g.topics) {
    if (!topic.parentId) continue
    edges.push({ id: `belong:${topic.id}`, type: 'belongTo', kind: 'topic', from: topic.id, to: topic.parentId })
  }
  for (const rel of relations || g.relations || []) {
    edges.push({ id: `rel:${rel.from}>${rel.to}:${rel.label}`, type: 'has_relation', from: rel.from, to: rel.to, label: rel.label, kind: rel.kind })
  }
  for (const branch of branches || []) {
    if (!branch.parentTopicId) continue
    edges.push({
      id: `deleg:${branch.parentTopicId}>${branch.sessionId}`,
      type: 'delegates',
      from: branch.parentTopicId,
      to: branch.sessionId,
      label: '子智能体',
    })
  }
  return edges
}

/** 把子智能体分支的 token / 时间汇总到父话题上。 */
function attachBranchesToTopics(topicsPayload, branches) {
  const byTopic = new Map()
  for (const branch of branches || []) {
    if (!branch.parentTopicId) continue
    if (!byTopic.has(branch.parentTopicId)) byTopic.set(branch.parentTopicId, [])
    byTopic.get(branch.parentTopicId).push(branch)
  }
  for (const topic of topicsPayload) {
    const attached = byTopic.get(topic.id)
    if (!attached || !attached.length) continue
    const branchAgg = emptyAggregate()
    for (const branch of attached) {
      const totals = branch.totals || {}
      const tokens = totals.tokens || {}
      for (const key of Object.keys(branchAgg.tokens)) branchAgg.tokens[key] += numOr0(tokens[key])
      branchAgg.turnCount += numOr0(totals.turnCount)
      branchAgg.toolCalls.total += numOr0(totals.toolCalls?.total)
      branchAgg.wallMs += numOr0(totals.wallMs)
      branchAgg.agentMs += numOr0(totals.agentMs)
    }
    topic.branchIds = attached.map((b) => b.sessionId)
    topic.branchStats = {
      branchCount: attached.length,
      turnCount: branchAgg.turnCount,
      tokens: branchAgg.tokens,
      toolCalls: branchAgg.toolCalls,
      wallMs: branchAgg.wallMs,
      agentMs: branchAgg.agentMs,
    }
  }
}

function buildGraphPayload(g, title, branches) {
  const branchList = Array.isArray(branches) ? branches : []
  const turns = snapshotTurns(g)
  const stats = computeGraphStats(g, turns)
  const { totalAgg, topicAgg, stageAgg } = stats

  const children = childrenIndex(g)
  const byId = topicsById(g)
  const topicsPayload = g.topics.map((topic) => {
    const range = topicTurnRange(g, topic, children)
    const agg = topicAgg.get(topic.id) || emptyAggregate()
    return {
      id: topic.id,
      title: topic.title,
      summary: topic.summary,
      parentId: topic.parentId,
      stageId: topic.stageId,
      status: topic.status,
      source: topic.source,
      level: topicDepth(byId, topic),
      childIds: (children.get(topic.id) || []).map((t) => t.id),
      turnStart: range.start,
      turnEnd: range.end,
      ownTurns: topic.ownTurns.slice(),
      stats: statsView(agg, totalAgg),
    }
  })
  attachBranchesToTopics(topicsPayload, branchList)

  const stagesPayload = g.stages.map((stage) => {
    const rootIds = g.topics.filter((t) => t.parentId == null && t.stageId === stage.id).map((t) => t.id)
    const agg = stageAgg.get(stage.id) || emptyAggregate()
    return {
      id: stage.id,
      title: stage.title,
      summary: stage.summary,
      order: stage.order,
      topicIds: rootIds,
      stats: statsView(agg, totalAgg),
    }
  }).sort((a, b) => a.order - b.order)

  const mergedRelations = mergeRelations(
    mergeRelations(g.relations, deriveRevisitRelations(g)),
    deriveExtensionRelations(g),
  )
  const lastTurn = turns.length ? turns[turns.length - 1] : null
  const settled = lastSettledTurn(g)
  const subagentAgg = emptyAggregate()
  for (const branch of branchList) {
    const totals = branch.totals || {}
    const tokens = totals.tokens || {}
    for (const key of Object.keys(subagentAgg.tokens)) subagentAgg.tokens[key] += numOr0(tokens[key])
    subagentAgg.turnCount += numOr0(totals.turnCount)
    subagentAgg.toolCalls.total += numOr0(totals.toolCalls?.total)
    subagentAgg.wallMs += numOr0(totals.wallMs)
    subagentAgg.agentMs += numOr0(totals.agentMs)
  }
  const totalToolCalls = totalAgg.toolCalls.total || 0
  const totalTurnMs = totalAgg.wallMs || 0
  const totalAgentMs = totalAgg.agentMs || 0

  return {
    ok: true,
    version: g.version,
    sessionId: g.sessionId,
    key: g.key,
    title: title || '',
    parentSessionId: g.parentSessionId || null,
    depth: Number(g.depth) || 0,
    updatedAt: g.updatedAt || '',
    ai: {
      mode: cfgRef.segmentMode,
      relationMode: cfgRef.relationMode,
      status: g.aiStatus,
      error: g.aiError,
      relationError: g.relationError || '',
      lastErrorAt: g.llmLastErrorAt || '',
      tokens: g.aiTokens,
      calls: g.aiCalls,
      progress: g.aiProgress || 0,
      pendingTurns: Math.max(0, settled - g.segmentedThroughTurn),
      segmentedThroughTurn: g.segmentedThroughTurn,
      lastAt: g.lastAiAt,
      provider: g.llmProvider,
      model: g.llmModel,
    },
    totals: {
      turnCount: turns.length,
      settledTurnCount: settled,
      tokens: totalAgg.tokens,
      toolCalls: totalAgg.toolCalls,
      wallMs: totalAgg.wallMs,
      agentMs: totalAgg.agentMs,
      requests: totalAgg.requests,
      toolErrors: totalAgg.toolErrors,
      openTurn: lastTurn && lastTurn.status === 'open' ? lastTurn.turn : null,
      topicCount: g.topics.filter((topic) => topic.parentId == null).length,
      subtopicCount: g.topics.filter((topic) => topic.parentId != null).length,
      stageCount: g.stages.length,
      relationCount: (g.relations || []).length,
      subagent: {
        branchCount: branchList.length,
        turnCount: subagentAgg.turnCount,
        tokens: subagentAgg.tokens,
        toolCalls: subagentAgg.toolCalls,
        wallMs: subagentAgg.wallMs,
        agentMs: subagentAgg.agentMs,
      },
    },
    turns: turns.map((turn) => ({
      turn: turn.turn,
      startTime: turn.startTime,
      endTime: turn.status === 'open' ? Math.max(turn.endTime || 0, turn.lastTime || 0) : turn.endTime,
      status: turn.status,
      prompt: summarize(turn.prompt, TURN_PROMPT_PREVIEW),
      assistant: summarize(turn.assistant, TURN_ASSISTANT_PREVIEW),
      promptFull: turn.prompt.length > TURN_PROMPT_PREVIEW,
      assistantFull: turn.assistant.length > TURN_ASSISTANT_PREVIEW,
      tokens: turn.tokens,
      tokenRatio: ratio(turn.tokens.total, totalAgg.tokens.total),
      toolCalls: turn.toolCalls,
      toolRatio: ratio(turn.toolCalls.total, totalToolCalls),
      wallMs: turnWallMs(turn),
      wallRatio: ratio(turnWallMs(turn), totalTurnMs),
      agentMs: Math.max(0, turn.agentMs),
      agentRatio: ratio(turn.agentMs, totalAgentMs),
      steps: turn.steps,
      requests: turn.requests,
      toolErrors: turn.toolErrors,
      reasoningChars: turn.reasoningChars,
      provider: turn.provider,
      model: turn.model,
    })),
    topics: topicsPayload,
    stages: stagesPayload,
    relations: mergedRelations.slice(),
    turnAnalyses: g.turnAnalyses || {},
    branches: branchList,
    edges: buildEdges(g, branchList, mergedRelations),
  }
}

// ── 子智能体分支 ───────────────────────────────────────────────────────────

/** 子智能体会话的轻量分支视图：主题、统计、与父话题的委托关系。 */
function buildBranchPayload(childGraph, parentGraph, meta, depth, title) {
  const childTurns = snapshotTurns(childGraph)
  const stats = computeGraphStats(childGraph, childTurns)
  const { totalAgg, topicAgg, stageAgg } = stats
  const firstTime = childTurns.length ? (childTurns[0].startTime || meta.createdAt || 0) : (meta.createdAt || 0)
  const parentTurn = findParentTurnForTime(parentGraph, firstTime)
  const parentTopic = parentTurn != null
    ? (topicOwningTurn(parentGraph, parentTurn) || lastTopicInOrder(parentGraph))
    : lastTopicInOrder(parentGraph)
  const lastTurn = childTurns.length ? childTurns[childTurns.length - 1] : null
  return {
    sessionId: childGraph.sessionId,
    key: childGraph.key,
    title: title || meta.title || '',
    depth,
    parentSessionId: parentGraph.sessionId,
    parentTurn,
    parentTopicId: parentTopic ? parentTopic.id : null,
    version: childGraph.version,
    pending: childTurns.length > 0 && childGraph.topics.length === 0,
    ai: {
      status: childGraph.aiStatus,
      error: childGraph.aiError,
      pendingTurns: Math.max(0, lastSettledTurn(childGraph) - childGraph.segmentedThroughTurn),
      segmentedThroughTurn: childGraph.segmentedThroughTurn,
    },
    totals: {
      turnCount: childTurns.length,
      settledTurnCount: lastSettledTurn(childGraph),
      tokens: totalAgg.tokens,
      toolCalls: totalAgg.toolCalls,
      wallMs: totalAgg.wallMs,
      agentMs: totalAgg.agentMs,
      openTurn: lastTurn && lastTurn.status === 'open' ? lastTurn.turn : null,
    },
    topics: childGraph.topics.map((topic) => {
      const range = topicTurnRange(childGraph, topic, childrenIndex(childGraph))
      return {
        id: topic.id,
        title: topic.title,
        summary: topic.summary,
        parentId: topic.parentId,
        stageId: topic.stageId,
        status: topic.status,
        turnStart: range.start,
        turnEnd: range.end,
        stats: statsView(topicAgg.get(topic.id) || emptyAggregate(), totalAgg),
      }
    }),
    stages: childGraph.stages.map((stage) => ({
      id: stage.id,
      title: stage.title,
      summary: stage.summary,
      order: stage.order,
      topicIds: childGraph.topics.filter((t) => t.parentId == null && t.stageId === stage.id).map((t) => t.id),
      stats: statsView(stageAgg.get(stage.id) || emptyAggregate(), totalAgg),
    })).sort((a, b) => a.order - b.order),
    relations: (childGraph.relations || []).slice(),
  }
}

/** 为父图谱收集子智能体分支（含嵌套子会话）。 */
async function buildBranches(ctx, parentGraph) {
  if (!cfgRef.includeSubagents) return []
  const state = stateOf()
  // 客户端可能先请求 /graph 再请求 /sessions：这里补一次血缘加载，否则看不到子智能体
  if (!state.lineageAt || Date.now() - state.lineageAt > 60000) {
    try { await listSessionsPayload(ctx) } catch { /* 血缘加载失败不影响主图 */ }
  }
  const maxDepth = clampInt(cfgRef.maxSubagentDepth, 2, 1, 5)
  const maxBranches = clampInt(cfgRef.maxBranches, 20, 1, 60)
  const descendants = collectDescendants(parentGraph.key, maxDepth).slice(0, maxBranches)
  if (!descendants.length) return []
  let titles = new Map()
  try { titles = await readTitles(ctx, descendants.map((item) => item.id)) } catch { /* 标题只是展示 */ }
  const branches = await Promise.all(descendants.map(async (item) => {
    const title = titles.get(item.id) || item.meta.title || ''
    let childGraph = null
    try { childGraph = await ensureGraph(ctx, item.id) } catch { childGraph = null }
    if (!childGraph || !childGraph.ready) {
      return {
        sessionId: item.id,
        key: item.key,
        title,
        depth: item.depth,
        parentSessionId: parentGraph.sessionId,
        parentTurn: null,
        parentTopicId: null,
        version: 0,
        pending: true,
        ai: { status: 'idle', error: '', pendingTurns: 0, segmentedThroughTurn: 0 },
        totals: { turnCount: 0, settledTurnCount: 0, tokens: emptyTokens(), toolCalls: { total: 0, byName: {} }, wallMs: 0, agentMs: 0, openTurn: null },
        topics: [],
        stages: [],
        relations: [],
      }
    }
    return buildBranchPayload(childGraph, parentGraph, item.meta, item.depth, title)
  }))
  return branches
}

// ── 标题 / 会话列表 ─────────────────────────────────────────────────────────

async function readTitles(ctx, ids) {
  const state = stateOf()
  const now = Date.now()
  const missing = []
  for (const id of ids) {
    const cached = state.titleCache.get(normSessionId(id))
    if (!cached || now - cached.at > TITLE_TTL_MS) missing.push(id)
  }
  if (missing.length && ctx.sessionQuery && typeof ctx.sessionQuery.readTitleSnapshots === 'function') {
    try {
      const results = await ctx.sessionQuery.readTitleSnapshots(missing)
      const { fulfilled } = groupTitleResults(results)
      for (const [id, value] of fulfilled) {
        state.titleCache.set(normSessionId(id), { title: value, at: now })
      }
      capTitleCache(state)
    } catch { /* 忽略：标题只是展示信息 */ }
  }
  const out = new Map()
  for (const id of ids) {
    const cached = state.titleCache.get(normSessionId(id))
    if (cached) out.set(id, cached.title)
  }
  return out
}

function groupTitleResults(results) {
  const fulfilled = new Map()
  if (!Array.isArray(results)) return { fulfilled }
  for (const item of results) {
    if (!item || item.status !== 'fulfilled' || !item.value) continue
    const id = item.sessionId || item.value.session?.id
    const title = item.value.title?.title
    if (id && typeof title === 'string' && title) fulfilled.set(id, title)
  }
  return { fulfilled }
}

async function listSessionsPayload(ctx) {
  const state = stateOf()
  const now = Date.now()
  if (state.sessionsCache && now - state.sessionsCache.at < SESSIONS_TTL_MS) return state.sessionsCache.value
  const value = { version: 0, sessions: [], current: null }
  try {
    const records = await ctx.sessionQuery.listSessions()
    const allRecords = (Array.isArray(records) ? records : []).filter((record) => record && record.header)
    // 会话血缘（父子 / 委托深度）必须先于列表过滤记录，供子智能体分支使用
    const state = stateOf()
    for (const record of allRecords) {
      updateSessionMeta(record.header.id, record.header)
      const meta = state.sessionParents.get(normSessionId(record.header.id))
      if (meta) meta.lastActiveAt = Math.max(meta.lastActiveAt || 0, state.lastSeen.get(meta.key) || 0)
    }
    const filtered = allRecords
      .filter((record) => record && record.header)
      .filter((record) => cfgRef.showSubagents || !isSubagentHeader(record.header))
      .sort((a, b) => (b.header.createdAt || 0) - (a.header.createdAt || 0))
      .slice(0, SESSIONS_LIMIT)
    const ids = filtered.map((record) => record.header.id)
    const titles = await readTitles(ctx, ids)
    const liveIds = new Set()
    try {
      const sessionsService = getHostService(ctx, 'sessions')
      const live = sessionsService && typeof sessionsService.list === 'function' ? sessionsService.list() : []
      for (const session of live || []) liveIds.add(normSessionId(session.id))
    } catch { /* 忽略 */ }
    const rows = filtered.map((record) => {
      const id = record.header.id
      const key = normSessionId(id)
      const title = titles.get(id) || titles.get(key) || ''
      const graph = state.graphs.get(key)
      const parentId = record.header.parentSession || null
      return {
        id,
        key,
        title,
        cwd: record.header.cwd || '',
        createdAt: record.header.createdAt || 0,
        lastActiveAt: state.lastSeen.get(key) || graph?.lastEventAt || 0,
        live: record.live === true || liveIds.has(key),
        archived: false,
        parentId,
        depth: Number(record.header.delegationDepth) || 0,
        isSubagent: isSubagentHeader(record.header),
        turns: graph && graph.ready ? graph.turns.length : 0,
        hasSegment: state.segmentKeys.has(key) || (graph && graph.topics.length > 0) || false,
      }
    })
    rows.sort((a, b) => {
      const aAt = a.lastActiveAt || a.createdAt
      const bAt = b.lastActiveAt || b.createdAt
      return bAt - aAt
    })
    value.sessions = rows
    const mains = rows.filter((row) => !row.isSubagent)
    value.current = (mains.length ? mains[0] : rows[0])?.id || null
    value.version = state.dataVersion
    state.lineageAt = Date.now()
  } catch (error) {
    value.error = summarize(String(error?.message || error), 160)
  }
  state.sessionsCache = { at: now, value }
  return value
}

async function currentSessionId(ctx) {
  const payload = await listSessionsPayload(ctx)
  return payload.current || null
}

// ── 浏览器路由 ──────────────────────────────────────────────────────────────

function registerRoutes(ctx) {
  const dispose = ctx.webServer.register({
    kind: 'prefix',
    path: ROUTE_BASE,
    handler: async (req, res) => {
      try {
        const url = new URL(req.url || '/', 'http://localhost')
        const sub = url.pathname.slice(ROUTE_BASE.length).replace(/\/+$/, '') || '/'
        if (sub === '/ping') {
          sendJson(res, 200, { ok: true, name, version: '0.6.41', dataDir: dataRoot() })
          return
        }
        if (sub === '/sessions') {
          const payload = await listSessionsPayload(ctx)
          sendJson(res, 200, payload)
          return
        }
        if (sub === '/graph') {
          let sessionId = url.searchParams.get('sessionId') || ''
          if (!sessionId) sessionId = await currentSessionId(ctx)
          if (!sessionId) {
            sendJson(res, 200, { ok: false, empty: true, message: '没有可用的会话', sessions: [] })
            return
          }
          const g = await ensureGraph(ctx, sessionId)
          // 子智能体分支（含嵌套）；只有在 includeSubagents 打开时才收集
          const branches = await buildBranches(ctx, g)
          const compositeVersion = g.version * 1000003
            + branches.reduce((sum, branch) => sum + (Number(branch.version) || 0), 0)
          const versionParam = url.searchParams.get('version')
          if (versionParam != null && Number(versionParam) === compositeVersion) {
            sendJson(res, 200, { ok: true, unchanged: true, version: compositeVersion })
            return
          }
          const titles = await readTitles(ctx, [g.sessionId, g.key])
          const title = titles.get(g.sessionId) || titles.get(g.key) || ''
          if (!g.aiError && !g.segRunning && lastSettledTurn(g) > g.segmentedThroughTurn) {
            scheduleSegment(ctx, g, {})
          }
          const payload = buildGraphPayload(g, title, branches)
          payload.version = compositeVersion
          payload.graphVersion = g.version
          sendJson(res, 200, payload)
          return
        }
        if (sub === '/segment') {
          if (req.method !== 'POST') {
            sendJson(res, 405, { ok: false, error: 'method not allowed' })
            return
          }
          const body = await readJsonBody(req)
          let sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
          if (!sessionId) sessionId = await currentSessionId(ctx)
          if (!sessionId) {
            sendJson(res, 400, { ok: false, error: 'sessionId required' })
            return
          }
          const g = await ensureGraph(ctx, sessionId)
          const full = body.full === true
          scheduleSegment(ctx, g, { full, force: true })
          if (full) {
            // 立刻开始，不等防抖（手动操作需要即时反馈）
            clearTimeout(g.segmentTimer)
            g.segmentTimer = setTimeout(() => { g.segmentTimer = null; void runSegment(ctx, g, { full: true }) }, 30)
          }
          sendJson(res, 200, { ok: true, sessionId: g.sessionId, queued: true, full })
          return
        }
        if (sub === '/models') {
          const llm = getHostService(ctx, 'llm')
          const providers = []
          try {
            let listed = llm && typeof llm.listProviders === 'function' ? llm.listProviders() : []
            if (listed && typeof listed.then === 'function') listed = await listed
            for (const item of (Array.isArray(listed) ? listed : [])) {
              if (!item || !item.id) continue
              let models = []
              try {
                const m = await llm.listModels(item.id)
                models = (Array.isArray(m) ? m : [])
                  .filter((x) => x && x.id)
                  .map((x) => ({ id: x.id, name: x.name || x.id }))
              } catch { models = [] }
              providers.push({ id: item.id, name: item.name || item.id, models })
            }
          } catch { /* 列表失败返回空 */ }
          sendJson(res, 200, { ok: true, providers, current: { provider: cfgRef.provider || '', model: cfgRef.model || '' } })
          return
        }
        if (sub === '/model') {
          if (req.method !== 'POST') {
            sendJson(res, 405, { ok: false, error: 'method not allowed' })
            return
          }
          const body = await readJsonBody(req, 16 * 1024)
          const provider = typeof body?.provider === 'string' ? body.provider.trim() : ''
          const model = typeof body?.model === 'string' ? body.model.trim() : ''
          if (!provider || !model) {
            sendJson(res, 400, { ok: false, error: 'provider/model required' })
            return
          }
          cfgRef.provider = provider
          cfgRef.model = model
          try { await saveModelOverride(provider, model) } catch { /* 覆盖文件写失败不致命 */ }
          sendJson(res, 200, { ok: true, provider, model })
          return
        }
        if (sub === '/model-clear') {
          if (req.method !== 'POST') {
            sendJson(res, 405, { ok: false, error: 'method not allowed' })
            return
          }
          cfgRef.provider = baseCfg.provider
          cfgRef.model = baseCfg.model
          try { await unlink(modelFile()) } catch { /* 没有覆盖文件 */ }
          sendJson(res, 200, { ok: true, provider: cfgRef.provider, model: cfgRef.model })
          return
        }
        if (sub === '/analyze-turn') {
          if (req.method !== 'POST') {
            sendJson(res, 405, { ok: false, error: 'method not allowed' })
            return
          }
          const body = await readJsonBody(req, 64 * 1024)
          const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : ''
          const turn = clampInt(body?.turn, 0, 1, 1000000)
          const force = body?.force === true
          if (!sessionId || !turn) {
            sendJson(res, 400, { ok: false, error: 'sessionId/turn required' })
            return
          }
          try {
            const analysis = await analyzeTurn(ctx, sessionId, turn, { force })
            sendJson(res, 200, { ok: true, sessionId, turn, analysis })
          } catch (error) {
            const code = error && error.code === 'PARSE_OUTPUT' ? 'PARSE_OUTPUT' : 'ANALYZE'
            const message = code === 'PARSE_OUTPUT' ? 'AI 分析输出无法解析，请重试' : describeLlmError(error)
            sendJson(res, 500, { ok: false, error: message, code })
          }
          return
        }
        sendJson(res, 404, { ok: false, error: 'not found' })
      } catch (error) {
        try {
          sendJson(res, 500, { ok: false, error: summarize(String(error?.stack || error?.message || error), 400) })
        } catch { /* response already sent */ }
      }
    },
  })
  return dispose
}

// ── 插件入口 ────────────────────────────────────────────────────────────────

let baseCfg = { provider: '', model: '' }
let cfgRef = {
  segmentMode: 'auto',
  provider: '',
  model: '',
  batchTurns: 6,
  maxInputChars: 8000,
  debounceMs: 2500,
  minGapMs: 8000,
  autoSegment: true,
  showSubagents: false,
  includeSubagents: true,
  maxSubagentDepth: 2,
  maxBranches: 20,
  relationMode: 'titles',
  reasoningEffort: 'off',
  ruleTurnsPerTopic: 3,
  ruleTopicsPerStage: 5,
}

export function apply(ctx, config) {
  cfgRef = {
    segmentMode: ['auto', 'llm', 'rule'].includes(config?.segmentMode) ? config.segmentMode : 'auto',
    provider: typeof config?.provider === 'string' ? config.provider : '',
    model: typeof config?.model === 'string' ? config.model : '',
    batchTurns: clampInt(config?.batchTurns, 6, 1, 30),
    maxInputChars: clampInt(config?.maxInputChars, 8000, 2000, 60000),
    debounceMs: clampInt(config?.debounceMs, 2500, 300, 60000),
    minGapMs: clampInt(config?.minGapMs, 8000, 0, 300000),
    autoSegment: config?.autoSegment !== false,
    showSubagents: config?.showSubagents === true,
    includeSubagents: config?.includeSubagents !== false,
    maxSubagentDepth: clampInt(config?.maxSubagentDepth, 2, 1, 5),
    maxBranches: clampInt(config?.maxBranches, 20, 1, 60),
    relationMode: ['titles', 'inline', 'off'].includes(config?.relationMode) ? config.relationMode : 'titles',
    reasoningEffort: ['off', 'low', 'high', 'max'].includes(config?.reasoningEffort) ? config.reasoningEffort : 'off',
    ruleTurnsPerTopic: clampInt(config?.ruleTurnsPerTopic, 3, 1, 20),
    ruleTopicsPerStage: clampInt(config?.ruleTopicsPerStage, 5, 1, 50),
  }

  stateRef = createState()
  baseCfg = { provider: cfgRef.provider, model: cfgRef.model }

  // 载入用户上次选择的切分模型（异步，不阻塞插件就绪）
  void loadModelOverride().catch(() => {})

  // 载入磁盘上已有的切分结果索引（只记录 key，具体内容按需读取）
  void (async () => {
    try {
      await mkdir(dataRoot(), { recursive: true })
      const files = await readdir(dataRoot())
      for (const file of files) {
        if (!file.endsWith('.json')) continue
        stateOf().segmentKeys.add(file.slice(0, -'.json'.length))
      }
    } catch { /* 数据目录不可用不致命 */ }
  })()

  // 实时事件：折叠进图状态 + 在轮次结束时触发增量切分
  const disposeSessionEvent = ctx.on('session/event', (session, event) => {
    if (!session || !event) return
    const sessionId = session.id
    if (!sessionId) return
    // 子代理会话默认也纳入（作为父会话的分支显示），关闭 includeSubagents 后完全忽略
    if (isSubagentSession(session) && !cfgRef.includeSubagents) return
    const key = normSessionId(sessionId)
    const state = stateOf()
    const eventTime = normalizeTime(event.time) || Date.now()
    state.lastSeen.set(key, eventTime)
    updateSessionMeta(session.id, session.header)
    const meta = state.sessionParents.get(key)
    if (meta) meta.lastActiveAt = Math.max(meta.lastActiveAt || 0, eventTime)
    let g = state.graphs.get(key)
    if (!g) {
      g = createGraph(sessionId)
      state.graphs.set(key, g)
      g.pending.push(event)
      void ensureGraph(ctx, sessionId).catch(() => {})
      return
    }
    if (!g.ready) {
      g.pending.push(event)
      return
    }
    if (applyEvent(g, event)) {
      g.version += 1
      touchGraph(g)
      state.dataVersion += 1
      state.sessionsCache = null
      evictGraphsIfNeeded(state)
      if (event.type === 'turn/end' || (event.type === 'turn/start' && Number(event.data?.turn) > 1)) {
        scheduleSegment(ctx, g, {})
      }
    }
  })

  const disposeRoutes = registerRoutes(ctx)

  // 卸载：清定时器 + 尽力落盘
  return () => {
    disposeSessionEvent()
    disposeRoutes()
    for (const g of stateOf().graphs.values()) {
      clearTimeout(g.saveTimer)
      clearTimeout(g.segmentTimer)
      if (g.ready && g.topics.length) void saveGraphNow(g)
    }
  }
}

// ── 测试钩子（仅供本地单元测试调用；Loader 只读取 name/inject/apply） ──────

export const __test = {
  createGraph,
  titleSimilarity,
  deriveRevisitRelations,
  deriveExtensionRelations,
  mergeRelations,
  applyEvent,
  rebuildFromEvents,
  applyAiStructure,
  applyRuleStructure,
  applyExtendFallback,
  collectBatch,
  lastSettledTurn,
  buildGraphPayload,
  buildTurnTrace,
  renderTurnTrace,
  analyzeTurn,
  parseTurnAnalysisJson,
  createState,
  parseGraphJson,
  runSegment,
  buildSegmentInput,
  getHostService,
  resolveLlmTarget,
  stateOf,
  setConfig(next) {
    cfgRef = { ...cfgRef, ...(next || {}) }
  },
  getConfig() { return { ...cfgRef } },
}
