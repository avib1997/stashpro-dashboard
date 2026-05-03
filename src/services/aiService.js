// ─── AI Insights Service ──────────────────────────────────────────────────────
// Direct Anthropic call via corsproxy.io to sidestep browser CORS.
// For production, move to a server-side route so the key stays secret.

const API_KEY   = import.meta.env.VITE_ANTHROPIC_API_KEY
const API_URL   = 'https://corsproxy.io/?https://api.anthropic.com/v1/messages'
const MODEL     = 'claude-3-5-haiku-20241022'
const MAX_TOKENS = 300

const SYSTEM_PROMPT =
  'You are an elite, concise financial advisor for the StashPro app. ' +
  'Analyze the user\'s data. Output exactly 3 bullet points in Hebrew. ' +
  'No intro, no outro, just 3 short actionable sentences focusing on ' +
  'anomalies, category spending, or budget pace.'

const fmtILS = (n) => `₪${Math.round(n).toLocaleString('he-IL')}`

// ─── Data summary ─────────────────────────────────────────────────────────────

function buildSummary(transactions, settings) {
  // last-30-days window
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - 30)
  const cutoffStr = cutoff.toISOString().slice(0, 10)
  const recent = transactions.filter((t) => (t.date ?? '') >= cutoffStr)

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

  const top3 = Object.entries(catMap)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)
    .map(([name, amount]) => ({ name, amount: Math.round(amount) }))

  // current-month pace
  const now        = new Date()
  const day        = now.getDate()
  const totalDays  = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  const monthStr   = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const monthLimit = Number(settings.monthlyLimit) || 0

  let monthExpenses = 0
  for (const t of transactions) {
    if (t.type === 'expense' && (t.date ?? '').startsWith(monthStr))
      monthExpenses += Number(t.amount) || 0
  }
  monthExpenses = Math.round(monthExpenses)

  const expectedByNow = monthLimit > 0 ? Math.round((day / totalDays) * monthLimit) : 0
  let paceStatus
  if (!monthLimit) {
    paceStatus = 'לא הוגדרה מסגרת חודשית'
  } else if (monthExpenses > monthLimit) {
    paceStatus = `חריגה מהמסגרת — ${fmtILS(monthExpenses)} מתוך ${fmtILS(monthLimit)}`
  } else if (monthExpenses > expectedByNow) {
    paceStatus = `קצב הוצאות מהיר — ${fmtILS(monthExpenses)} vs. צפי ${fmtILS(expectedByNow)} (מסגרת: ${fmtILS(monthLimit)})`
  } else {
    paceStatus = `קצב הוצאות תקין — ${fmtILS(monthExpenses)} vs. צפי ${fmtILS(expectedByNow)} (מסגרת: ${fmtILS(monthLimit)})`
  }

  return {
    totalSpent:  Math.round(totalSpent),
    totalIncome: Math.round(totalIncome),
    balance:     Math.round(totalIncome - totalSpent),
    top3,
    txCount:     recent.length,
    paceStatus,
  }
}

// ─── Fallback (no key or API failure) ────────────────────────────────────────

function generateFallbackInsights(summary) {
  const { totalSpent, totalIncome, balance, top3, paceStatus } = summary
  const out = []

  if (top3.length > 0) {
    const cats = top3.map((c) => `${c.name} (${fmtILS(c.amount)})`).join(', ')
    out.push(`ב-30 הימים האחרונים הקטגוריות המובילות הן: ${cats}.`)
  }

  if (totalIncome > 0) {
    const rate    = Math.round(((totalIncome - totalSpent) / totalIncome) * 100)
    const verdict =
      rate > 20 ? 'שיעור חיסכון מעולה — המשך כך!'
      : rate > 5  ? 'שיעור חיסכון סביר — שאוף ל-20%+'
      : rate > 0  ? 'שיעור נמוך — בחן היכן ניתן לקצץ'
      :              'גירעון — ההוצאות עולות על ההכנסות'
    out.push(`שיעור חיסכון: ${rate}% — ${verdict}.`)
  }

  out.push(`קצב חודשי: ${paceStatus}.`)

  if (!out.length) out.push('הוסף עסקאות כדי לקבל תובנות פיננסיות.')
  return out.slice(0, 3)
}

// ─── Response parser ──────────────────────────────────────────────────────────

function parseInsights(text) {
  return text
    .split('\n')
    .map((line) =>
      line
        .replace(/^\s*[•\-\*•]\s*/, '')  // strip bullet chars (•, -, *, •)
        .replace(/^\s*\d+[\.\)]\s*/, '')       // strip "1." / "1)"
        .replace(/\*\*/g, '')                  // strip markdown bold
        .trim()
    )
    .filter((line) => line.length > 6)
    .slice(0, 3)
}

// ─── Anthropic API call ───────────────────────────────────────────────────────

async function callClaudeApi(summary) {
  const { totalSpent, totalIncome, balance, top3, paceStatus } = summary
  const catLines = top3.length
    ? top3.map((c) => `  • ${c.name}: ${fmtILS(c.amount)}`).join('\n')
    : '  אין נתונים'

  const userContent = [
    `הכנסות סה"כ (30 יום): ${fmtILS(totalIncome)}`,
    `הוצאות סה"כ (30 יום): ${fmtILS(totalSpent)}`,
    `יתרה נטו: ${fmtILS(balance)}`,
    `קטגוריות הוצאה מובילות:\n${catLines}`,
    `קצב תקציב חודשי: ${paceStatus}`,
  ].join('\n')

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'content-type':      'application/json',
      'x-api-key':         API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:      MODEL,
      max_tokens: MAX_TOKENS,
      system:     SYSTEM_PROMPT,
      messages:   [{ role: 'user', content: userContent }],
    }),
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => res.status)
    throw new Error(`Anthropic ${res.status}: ${errText}`)
  }

  const data     = await res.json()
  const rawText  = data.content?.[0]?.text ?? ''
  const insights = parseInsights(rawText)

  if (insights.length === 0) throw new Error('Empty parsed insights')
  return insights
}

// ─── Public export ────────────────────────────────────────────────────────────

export async function fetchAiInsights(transactions, settings) {
  const summary = buildSummary(transactions, settings)

  if (!API_KEY) {
    return generateFallbackInsights(summary)
  }

  try {
    return await callClaudeApi(summary)
  } catch (err) {
    console.warn('[aiService] API call failed, using fallback:', err.message)
    return generateFallbackInsights(summary)
  }
}
