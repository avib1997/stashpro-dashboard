// ─── AI Insights Service ──────────────────────────────────────────────────────
// Uses VITE_AI_API_KEY (Anthropic Claude) when available.
// Note: for production, proxy through a backend to avoid exposing the key.

const AI_API_KEY = import.meta.env.VITE_AI_API_KEY

const fmtILS = (n) => `₪${Math.round(n).toLocaleString('he-IL')}`

// ─── Data summarisation ───────────────────────────────────────────────────────

function summarizeLast30Days(transactions) {
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
      const cat = t.category || 'אחר'
      catMap[cat] = (catMap[cat] || 0) + amt
    } else {
      totalIncome += amt
    }
  }

  const top3 = Object.entries(catMap)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)
    .map(([name, amount]) => ({ name, amount: Math.round(amount) }))

  return {
    totalSpent:  Math.round(totalSpent),
    totalIncome: Math.round(totalIncome),
    balance:     Math.round(totalIncome - totalSpent),
    top3,
    txCount:     recent.length,
  }
}

// ─── Fallback (no API key) ────────────────────────────────────────────────────

function generateFallbackInsights(summary) {
  const { totalSpent, totalIncome, balance, top3, txCount } = summary
  const out = []

  if (top3.length > 0) {
    const cats = top3.map((c) => `${c.name} (${fmtILS(c.amount)})`).join(', ')
    out.push(`ב-30 הימים האחרונים הקטגוריות המובילות הן: ${cats}.`)
  }

  if (totalIncome > 0) {
    const rate = Math.round(((totalIncome - totalSpent) / totalIncome) * 100)
    const verdict =
      rate > 20 ? 'שיעור חיסכון מעולה — המשך כך!'
      : rate > 5  ? 'שיעור חיסכון סביר — שאוף ל-20%+'
      : rate > 0  ? 'שיעור נמוך — בחן היכן ניתן לקצץ'
      :              'גירעון — ההוצאות עולות על ההכנסות'
    out.push(`שיעור חיסכון חודשי: ${rate}% — ${verdict}.`)
  }

  if (balance >= 0) {
    out.push(`יתרה נטו ב-30 הימים: ${fmtILS(balance)} על פני ${txCount} עסקאות.`)
  } else {
    const topCat = top3[0]?.name ?? 'הקטגוריות המובילות'
    out.push(`גירעון של ${fmtILS(Math.abs(balance))} ב-30 יום — שקול לצמצם ב"${topCat}".`)
  }

  if (!out.length) out.push('הוסף עסקאות מ-30 הימים האחרונים לקבלת תובנות AI.')
  return out
}

// ─── API call ─────────────────────────────────────────────────────────────────

async function callClaudeApi(summary) {
  const { totalSpent, totalIncome, balance, top3 } = summary
  const catLines = top3.map((c) => `  - ${c.name}: ${fmtILS(c.amount)}`).join('\n')

  const userMessage = [
    'אתה יועץ פיננסי אישי. נתח את הנתונים הבאים מ-30 הימים האחרונים ותן בדיוק 3 המלצות קצרות, ממוקדות ומועילות בעברית.',
    '',
    `הכנסות סה"כ: ${fmtILS(totalIncome)}`,
    `הוצאות סה"כ: ${fmtILS(totalSpent)}`,
    `יתרה: ${fmtILS(balance)}`,
    `קטגוריות הוצאה מובילות:\n${catLines || '  אין נתונים'}`,
    '',
    'ענה אך ורק עם מערך JSON תקין: ["המלצה 1","המלצה 2","המלצה 3"]',
  ].join('\n')

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': AI_API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      messages: [{ role: 'user', content: userMessage }],
    }),
  })

  if (!res.ok) throw new Error(`Anthropic API ${res.status}`)

  const data = await res.json()
  const raw  = data.content?.[0]?.text ?? ''
  const match = raw.match(/\[[\s\S]*?\]/)
  if (!match) throw new Error('No JSON array in response')

  const parsed = JSON.parse(match[0])
  if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('Empty array')
  return parsed.slice(0, 3)
}

// ─── Public export ────────────────────────────────────────────────────────────

export async function fetchAiInsights(transactions, settings) {
  const summary = summarizeLast30Days(transactions)

  if (!AI_API_KEY) {
    return generateFallbackInsights(summary)
  }

  try {
    return await callClaudeApi(summary)
  } catch {
    return generateFallbackInsights(summary)
  }
}
