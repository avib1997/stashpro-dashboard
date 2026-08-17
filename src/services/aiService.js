// ─── AI Insights Service ───────────────────────────────────────────────────
// Calls the local Vite proxy (/api/ai → api.anthropic.com).
// Rate-limited to once per calendar day per panel via localStorage.

const MODEL      = 'claude-haiku-4-5-20251001'
const MAX_TOKENS = 500

// ─── System prompts ────────────────────────────────────────────────────────

const MONTHLY_PROMPT =
  'You are a Senior Wealth Manager for the StashPro personal finance app.\n' +
  'Focus ONLY on the CURRENT MONTH: budget pace, adherence to the monthly limit, ' +
  'and the largest individual transactions this month. ' +
  'If a family context is provided, tie the advice directly to their stated goals.\n' +
  'Output EXACTLY 3 bullet points in Hebrew. Each ≤ 20 Hebrew words. ' +
  'No intro, no outro, no numbering — just 3 bullet lines.'

const GENERAL_PROMPT =
  'You are a Senior Wealth Manager and behavioral finance expert for the StashPro app.\n' +
  'Focus on BEHAVIORAL PATTERNS and LONG-TERM trends: month-over-month shifts, ' +
  'category anomalies, and strategic advice tailored to the user\'s family/life context. ' +
  'Do NOT restate totals the user already sees on screen.\n' +
  'Output EXACTLY 3 bullet points in Hebrew. Each ≤ 20 Hebrew words. ' +
  'No intro, no outro, no numbering — just 3 bullet lines.'

const RECOMMENDATIONS_PROMPT =
  'You are a Senior Wealth Manager for the StashPro personal finance app.\n' +
  'Based on ALL the financial data provided, generate EXACTLY 5 concrete, actionable ' +
  'financial recommendations in Hebrew. If family context is provided, make the ' +
  'recommendations directly relevant to those goals.\n' +
  'Each recommendation must be ≤ 25 Hebrew words, specific, and immediately actionable. ' +
  'No intro, no outro, no numbering — just 5 bullet lines.'

const fmtILS = (n) => `₪${Math.round(n).toLocaleString('he-IL')}`

// ─── Rate-limit helpers ────────────────────────────────────────────────────

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

function getCached(panelName) {
  try {
    if (localStorage.getItem(`ai_last_call_${panelName}`) !== todayStr()) return null
    return JSON.parse(localStorage.getItem(`ai_cache_${panelName}`) || 'null')
  } catch {
    return null
  }
}

function setCache(panelName, data) {
  localStorage.setItem(`ai_last_call_${panelName}`, todayStr())
  localStorage.setItem(`ai_cache_${panelName}`, JSON.stringify(data))
}

// ─── Data summary ──────────────────────────────────────────────────────────

function buildSummary(transactions, settings) {
  const now         = new Date()
  const day         = now.getDate()
  const totalDays   = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  const curMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const prevDate    = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const prevMonthStr = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`

  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - 30)
  const recent = transactions.filter((t) => (t.date ?? '') >= cutoff.toISOString().slice(0, 10))

  let totalSpent = 0, totalIncome = 0
  const catMap = {}
  for (const t of recent) {
    const amt = Number(t.amount) || 0
    if (t.type === 'expense') {
      totalSpent += amt
      catMap[t.category || 'אחר'] = (catMap[t.category || 'אחר'] || 0) + amt
    } else {
      totalIncome += amt
    }
  }

  const top3Categories = Object.entries(catMap)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)
    .map(([name, amount]) => ({ name, amount: Math.round(amount) }))

  let curMonthExp = 0, prevMonthExp = 0
  for (const t of transactions) {
    if (t.type !== 'expense') continue
    const d = t.date ?? ''
    if (d.startsWith(curMonthStr))  curMonthExp  += Number(t.amount) || 0
    if (d.startsWith(prevMonthStr)) prevMonthExp += Number(t.amount) || 0
  }
  curMonthExp  = Math.round(curMonthExp)
  prevMonthExp = Math.round(prevMonthExp)
  const momPct = prevMonthExp > 0
    ? Math.round(((curMonthExp - prevMonthExp) / prevMonthExp) * 100)
    : null

  const top3Largest = transactions
    .filter((t) => t.type === 'expense' && (t.date ?? '').startsWith(curMonthStr))
    .sort((a, b) => (Number(b.amount) || 0) - (Number(a.amount) || 0))
    .slice(0, 3)
    .map((t) => ({
      desc:     t.desc || t.category || 'ללא תיאור',
      category: t.category || 'אחר',
      amount:   Math.round(Number(t.amount) || 0),
    }))

  const monthLimit    = Number(settings.monthlyLimit) || 0
  const expectedByNow = monthLimit > 0 ? Math.round((day / totalDays) * monthLimit) : 0
  let paceStatus
  if (!monthLimit)              paceStatus = 'לא הוגדרה מסגרת חודשית'
  else if (curMonthExp > monthLimit)  paceStatus = `חריגה — ${fmtILS(curMonthExp)} מתוך ${fmtILS(monthLimit)}`
  else if (curMonthExp > expectedByNow) paceStatus = `קצב מהיר — ${fmtILS(curMonthExp)} vs. צפי ${fmtILS(expectedByNow)} (מסגרת: ${fmtILS(monthLimit)})`
  else                          paceStatus = `קצב תקין — ${fmtILS(curMonthExp)} vs. צפי ${fmtILS(expectedByNow)} (מסגרת: ${fmtILS(monthLimit)})`

  return {
    totalSpent:    Math.round(totalSpent),
    totalIncome:   Math.round(totalIncome),
    balance:       Math.round(totalIncome - totalSpent),
    top3Categories,
    top3Largest,
    momPct,
    curMonthExp,
    prevMonthExp,
    paceStatus,
    txCount:       recent.length,
    familyContext: (settings.familyContext || '').trim(),
  }
}

// ─── Fallback generators ───────────────────────────────────────────────────

function generateFallbackInsights(summary) {
  const { totalSpent, totalIncome, top3Categories, momPct, paceStatus } = summary
  const out = []

  if (top3Categories.length > 0) {
    const cats = top3Categories.map((c) => `${c.name} (${fmtILS(c.amount)})`).join(', ')
    out.push(`קטגוריות מובילות ב-30 יום: ${cats}.`)
  }
  if (momPct !== null) {
    const dir = momPct > 0 ? `עלייה של ${momPct}%` : `ירידה של ${Math.abs(momPct)}%`
    out.push(`שינוי חודשי: ${dir} בהוצאות ביחס לחודש הקודם.`)
  } else if (totalIncome > 0) {
    const rate    = Math.round(((totalIncome - totalSpent) / totalIncome) * 100)
    const verdict = rate > 20 ? 'מעולה — המשך כך'
      : rate > 5  ? 'סביר — שאוף ל-20%+'
      : rate > 0  ? 'נמוך — בחן היכן לקצץ'
      :              'גירעון — ההוצאות עולות על ההכנסות'
    out.push(`שיעור חיסכון: ${rate}% — ${verdict}.`)
  }
  out.push(`קצב חודשי: ${paceStatus}.`)
  return out.slice(0, 3)
}

function generateFallbackRecommendations(summary) {
  const { top3Categories, top3Largest, momPct, familyContext } = summary
  const out = []

  if (top3Categories[0])
    out.push(`צמצם הוצאות ב"${top3Categories[0].name}" — הקטגוריה הגדולה ביותר שלך.`)
  if (momPct !== null && momPct > 10)
    out.push(`הוצאות החודש עלו ב-${momPct}% — בחן מה גרם לזינוק ופעל להורידו.`)
  if (top3Largest[0])
    out.push(`העסקה הגדולה החודש: "${top3Largest[0].desc}" — בחן האם ניתן לצמצמה בפעם הבאה.`)
  out.push('הגדר מסגרת חודשית בהגדרות כדי לקבל התראות על חריגות בזמן אמת.')
  out.push('עיין בעסקאות החוזרות ובטל שירותים שאינך משתמש בהם באופן פעיל.')

  return out.slice(0, 5)
}

// ─── Response parser ───────────────────────────────────────────────────────

function parseInsights(text, limit) {
  return text
    .split('\n')
    .map((line) =>
      line
        .replace(/^\s*[•\-\*]\s*/, '')
        .replace(/^\s*\d+[\.\)]\s*/, '')
        .replace(/\*\*/g, '')
        .trim()
    )
    .filter((line) => line.length > 6)
    .slice(0, limit)
}

// ─── Core API call ─────────────────────────────────────────────────────────

async function callClaudeApi(summary, systemPrompt, limit) {
  const {
    top3Categories, top3Largest, momPct,
    curMonthExp, prevMonthExp, paceStatus, familyContext,
  } = summary

  const catLines   = top3Categories.length
    ? top3Categories.map((c) => `  • ${c.name}: ${fmtILS(c.amount)}`).join('\n')
    : '  אין נתונים'
  const largeLines = top3Largest.length
    ? top3Largest.map((t) => `  • ${t.desc} (${t.category}): ${fmtILS(t.amount)}`).join('\n')
    : '  אין עסקאות גדולות החודש'
  const momLine = momPct !== null
    ? `שינוי חודשי (MoM): ${momPct > 0 ? '+' : ''}${momPct}% (${fmtILS(prevMonthExp)} → ${fmtILS(curMonthExp)})`
    : 'שינוי חודשי (MoM): אין נתוני חודש קודם'

  const userContent = [
    familyContext ? `הקשר משפחתי/פיננסי: ${familyContext}` : 'הקשר משפחתי/פיננסי: לא סופק',
    '',
    `קטגוריות הוצאה מובילות (30 יום):\n${catLines}`,
    '',
    `3 עסקאות הגדולות ביותר החודש:\n${largeLines}`,
    '',
    momLine,
    `קצב תקציב: ${paceStatus}`,
  ].join('\n')

  const res = await fetch('/api/ai', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      model:      MODEL,
      max_tokens: MAX_TOKENS,
      system:     systemPrompt,
      messages:   [{ role: 'user', content: userContent }],
    }),
  })

  if (!res.ok) throw new Error(`Proxy error: ${res.status}`)

  const data     = await res.json()
  const rawText  = data.content?.[0]?.text ?? ''
  const insights = parseInsights(rawText, limit)

  if (insights.length === 0) throw new Error('Empty parsed insights')
  return insights
}

// ─── Public exports ────────────────────────────────────────────────────────

export async function fetchMonthlyInsights(transactions, settings) {
  const cached = getCached('monthly')
  if (cached) return cached

  const summary = buildSummary(transactions, settings)
  try {
    const result = await callClaudeApi(summary, MONTHLY_PROMPT, 3)
    setCache('monthly', result)
    return result
  } catch (err) {
    console.warn('[aiService:monthly]', err.message)
    return generateFallbackInsights(summary)
  }
}

export async function fetchGeneralInsights(transactions, settings) {
  const cached = getCached('general')
  if (cached) return cached

  const summary = buildSummary(transactions, settings)
  try {
    const result = await callClaudeApi(summary, GENERAL_PROMPT, 3)
    setCache('general', result)
    return result
  } catch (err) {
    console.warn('[aiService:general]', err.message)
    return generateFallbackInsights(summary)
  }
}

export async function fetchRecommendations(transactions, settings) {
  const cached = getCached('recommendations')
  if (cached) return cached

  const summary = buildSummary(transactions, settings)
  try {
    const result = await callClaudeApi(summary, RECOMMENDATIONS_PROMPT, 5)
    setCache('recommendations', result)
    return result
  } catch (err) {
    console.warn('[aiService:recommendations]', err.message)
    return generateFallbackRecommendations(summary)
  }
}
