import { useEffect, useState } from 'react'
import { collection, doc, getDocs, getDoc } from 'firebase/firestore'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ResponsiveContainer, BarChart, Bar,
  AreaChart, Area,
  LineChart, Line,
  ComposedChart,
  Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, CartesianGrid, Legend, ReferenceLine,
} from 'recharts'
import { auth, db } from '../firebase'
import { fetchAiInsights } from '../services/aiService'

// ─── constants ────────────────────────────────────────────────────────────────

const PIE_COLORS    = ['#06D6F7', '#10EFAA', '#FF3E6C', '#F59E0B', '#818CF8', '#F0ABFC', '#38BDF8']
const HEBREW_MONTHS = ['ינו׳','פבר׳','מרץ','אפר׳','מאי','יוני','יולי','אוג׳','ספט׳','אוק׳','נוב׳','דצמ׳']
const CURRENT_YEAR  = new Date().getFullYear()
const YEARS         = Array.from({ length: CURRENT_YEAR - 2019 }, (_, i) => String(CURRENT_YEAR - i))

const NAV_ITEMS = [
  { id: 'overview', label: 'סקירה',  icon: '◈' },
  { id: 'monthly',  label: 'חודשי',  icon: '◎' },
  { id: 'annual',   label: 'שנתי',   icon: '◉' },
  { id: 'reports',  label: 'דוחות',  icon: '▦' },
  { id: 'settings', label: 'הגדרות', icon: '⚙' },
]

// ─── pure data helpers ────────────────────────────────────────────────────────

const fmtILS = (n) => `₪${Math.round(n).toLocaleString('he-IL')}`

const nowMonthStr = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function filterByMonth(txs, monthStr) {
  return txs.filter((t) => t.date?.startsWith(monthStr) && t.period === 'monthly')
}

function filterByYear(txs, yearStr) {
  return txs.filter((t) => t.date?.startsWith(yearStr))
}

function processKpis(txs) {
  let income = 0, expenses = 0
  for (const t of txs) {
    const amt = Number(t.amount) || 0
    if (t.type === 'income') income += amt
    else expenses += amt
  }
  return { income, expenses, net: income - expenses }
}

function processByCategory(txs) {
  const map = {}
  for (const t of txs) {
    if (t.type !== 'expense') continue
    const amt = Number(t.amount) || 0
    map[t.category] = (map[t.category] || 0) + amt
  }
  return Object.entries(map)
    .map(([name, value]) => ({ name, value: Math.round(value) }))
    .sort((a, b) => b.value - a.value)
}

function processMonthlyComparison(txs, yearStr) {
  const map = {}
  for (let m = 1; m <= 12; m++) {
    const key = `${yearStr}-${String(m).padStart(2, '0')}`
    map[key] = { month: HEBREW_MONTHS[m - 1], income: 0, expense: 0 }
  }
  for (const t of txs.filter((t) => t.date?.startsWith(yearStr))) {
    const key = t.date?.slice(0, 7)
    if (!key || !map[key]) continue
    const amt = Number(t.amount) || 0
    if (t.type === 'income') map[key].income += amt
    else map[key].expense += amt
  }
  return Object.values(map).map((d) => ({
    ...d, income: Math.round(d.income), expense: Math.round(d.expense),
  }))
}

function calcPace(spent, limit) {
  const now  = new Date()
  const day  = now.getDate()
  const total = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  if (!limit) return { icon: '—', label: 'לא הוגדרה מסגרת', color: '#475569', expected: 0, day, total, spentPct: 0 }
  const expected = (day / total) * limit
  const spentPct = Math.min(spent / limit, 1)
  if (spent > limit)    return { icon: '🚨', label: 'חריגה מהמסגרת', color: '#FF3E6C', expected, day, total, spentPct }
  if (spent > expected) return { icon: '⚠️', label: 'קצב מהיר',      color: '#F59E0B', expected, day, total, spentPct }
  return                       { icon: '✅', label: 'קצב תקין',      color: '#10B981', expected, day, total, spentPct }
}

function generateInsights(txs, settings) {
  const limit    = Number(settings.monthlyLimit) || 0
  const { income, expenses } = processKpis(txs)
  const byCat    = processByCategory(txs)
  const top      = byCat[0]
  const now      = new Date()
  const day      = now.getDate()
  const total    = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  const burnRate = income > 0 ? Math.round((expenses / income) * 100) : 0
  const recurring = txs.filter((t) => t.period === 'monthly').length
  const out = []

  if (top) {
    const pct = expenses > 0 ? Math.round((top.value / expenses) * 100) : 0
    out.push(`הקטגוריה עם ההוצאה הגבוהה ביותר היא "${top.name}" עם ${fmtILS(top.value)} — ${pct}% מסך ההוצאות.`)
  }

  if (limit > 0) {
    const exp = (day / total) * limit
    if (expenses > exp) {
      out.push(`קצב ההוצאות מהיר מהצפוי — חרגת ב-${fmtILS(expenses - exp)} מהקצב היומי. שקול להאט את ההוצאות עד סוף החודש.`)
    } else {
      out.push(`קצב ההוצאות תקין. נותרו ${fmtILS(limit - expenses)} מהמסגרת — אתה בדרך הנכונה לסיים את החודש בתקציב.`)
    }
  }

  if (burnRate > 0) {
    const verdict = burnRate > 90 ? 'מצב קריטי — צמצם הוצאות מיידית'
      : burnRate > 70 ? 'שיעור גבוה — כדאי לבחון איפה ניתן לחסוך'
      : burnRate > 50 ? 'שיעור סביר — יש מקום לשיפור'
      : 'מצוין — אתה חוסך היטב'
    out.push(`שיעור שריפת התקציב: ${burnRate}% (${verdict}). יתרה נקייה: ${fmtILS(income - expenses)}.`)
  } else if (recurring > 0) {
    out.push(`נמצאו ${recurring} עסקאות חוזרות חודשיות. מומלץ לבחון האם כולן עדיין רלוונטיות.`)
  }

  if (!out.length) out.push('אין עדיין מספיק נתונים לייצור תובנות. הוסף עסקאות כדי להתחיל.')
  return out
}

function generateCurrentMonthInsights(filtered, settings) {
  const limit = Number(settings.monthlyLimit) || 0
  const { income, expenses } = processKpis(filtered)
  const top = processByCategory(filtered)[0]
  const now = new Date()
  const day = now.getDate()
  const totalDays = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  const projected = day > 0 ? (expenses / day) * totalDays : 0
  const out = []

  if (top) {
    const pct = expenses > 0 ? Math.round((top.value / expenses) * 100) : 0
    out.push(`הקטגוריה המובילה היא "${top.name}" — ${fmtILS(top.value)} (${pct}% מסך ההוצאות החודש).`)
  }
  if (limit > 0) {
    if (projected > limit)
      out.push(`לפי קצב יום ${day}/${totalDays}, צפויה חריגה של ${fmtILS(projected - limit)} עד סוף החודש.`)
    else
      out.push(`קצב תקין — צפי לסיים ב-${fmtILS(limit - projected)} מתחת למסגרת. נותרו ${fmtILS(limit - expenses)} ל-${totalDays - day} ימים.`)
  }
  if (income > 0) {
    const rate = Math.round(((income - expenses) / income) * 100)
    const v = rate > 20 ? 'מצוין — המשך כך' : rate > 0 ? 'סביר — שאוף ל-20%+' : 'גירעון — בדוק הכנסות'
    out.push(`שיעור חיסכון חודשי: ${rate}% — ${v}.`)
  }
  if (!out.length) out.push('אין עדיין נתונים לניתוח החודש הנוכחי.')
  return out
}

function generateHolisticInsights(transactions, settings) {
  const { income, expenses, net } = processKpis(transactions)
  const yearlyGoal = Number(settings.yearlyGoal) || 0
  const recurringExp = transactions.filter(t => t.period === 'monthly' && t.type === 'expense')
  const recurringTotal = recurringExp.reduce((s, t) => s + (Number(t.amount) || 0), 0)
  const uniqueMonths = new Set(transactions.map(t => t.date?.slice(0, 7)).filter(Boolean)).size
  const out = []

  if (income > 0) {
    const rate = Math.round((net / income) * 100)
    out.push(`היסטוריה כוללת: ${fmtILS(income)} הכנסות, ${fmtILS(expenses)} הוצאות — שיעור חיסכון ממוצע ${rate}%.`)
  }
  if (recurringExp.length > 0)
    out.push(`${recurringExp.length} הוצאות קבועות — ${fmtILS(recurringTotal)}/חודש. בדוק מה ניתן לצמצם.`)
  if (yearlyGoal > 0) {
    const pct = Math.min(Math.round((net / yearlyGoal) * 100), 100)
    out.push(`התקדמות ליעד ${fmtILS(yearlyGoal)}: ${pct}% הושג.${pct >= 100 ? ' כל הכבוד!' : ` נותר ${fmtILS(yearlyGoal - Math.max(net, 0))}.`}`)
  } else if (uniqueMonths > 1 && income > 0) {
    out.push(`ממוצע חודשי — ${uniqueMonths} חודשים: ${fmtILS(Math.round(income / uniqueMonths))} הכנסות, ${fmtILS(Math.round(expenses / uniqueMonths))} הוצאות.`)
  }
  if (!out.length) out.push('הוסף עסקאות לקבלת סקירת בריאות פיננסית כוללת.')
  return out
}

function processMultiYearCashflow(transactions) {
  const map = {}
  for (const t of transactions) {
    if (!t.date) continue
    const key = t.date.slice(0, 7)
    if (!map[key]) map[key] = { income: 0, expense: 0 }
    const amt = Number(t.amount) || 0
    if (t.type === 'income') map[key].income += amt
    else map[key].expense += amt
  }
  return Object.entries(map)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-18)
    .map(([key, d]) => ({
      label:   `${HEBREW_MONTHS[parseInt(key.slice(5, 7)) - 1]}'${key.slice(2, 4)}`,
      income:  Math.round(d.income),
      expense: Math.round(d.expense),
      net:     Math.round(d.income - d.expense),
    }))
}

function processBudgetVsActual(transactions, monthStr, limit) {
  const catMap = {}
  for (const t of transactions) {
    if (t.type !== 'expense' || !t.date?.startsWith(monthStr)) continue
    const cat = t.category || 'אחר'
    catMap[cat] = (catMap[cat] || 0) + (Number(t.amount) || 0)
  }
  const top5 = Object.entries(catMap).sort(([, a], [, b]) => b - a).slice(0, 5)
  const share = limit > 0 && top5.length > 0 ? limit / top5.length : 0
  return top5.map(([name, actual]) => ({
    name, actual: Math.round(actual), budget: Math.round(share), over: actual > share,
  }))
}

function processSavingsRadar(settings) {
  const goals = settings.savingsGoals || []
  return goals.map(g => ({
    subject:    g.name || '?',
    current:    Math.round(Math.min((Number(g.current) || 0) / (Number(g.target) || 1) * 100, 120)),
    target:     100,
    currentRaw: Number(g.current) || 0,
    targetRaw:  Number(g.target)  || 0,
  }))
}

const CAT_SLOT = {
  'קפה': 0, 'ארוחת בוקר': 0, 'תחבורה': 0, 'דלק': 0, 'חינוך': 0,
  'מכולת': 1, 'קניות': 1, 'ביגוד': 1, 'ביטוח': 1, 'טלפון': 1, 'בריאות': 1,
  'מסעדה': 2, 'מסעדות': 2, 'בידור': 2, 'ספורט': 2, 'אוכל': 2,
  'חשמל': 3, 'בנק': 3,
}

function processSpendingHeatmap(transactions) {
  const grid = Array.from({ length: 7 }, () => Array(4).fill(0))
  for (const t of transactions) {
    if (t.type !== 'expense' || !t.date) continue
    const d   = new Date(t.date + 'T12:00:00')
    const day  = d.getDay()
    const cat  = t.category || ''
    const slot = CAT_SLOT[cat] ?? ((t.id ? t.id.charCodeAt(t.id.length - 1) : 0) % 4)
    grid[day][Math.max(0, Math.min(slot, 3))] += Number(t.amount) || 0
  }
  return grid
}

function heatCellStyle(val, maxVal) {
  if (!val || maxVal === 0) return { background: '#161616', boxShadow: 'none' }
  const t = val / maxVal
  if (t < 0.15) return { background: '#2D1116', boxShadow: 'none' }
  if (t < 0.35) return { background: '#7F1D1D', boxShadow: 'none' }
  if (t < 0.55) return { background: '#B91C1C', boxShadow: 'none' }
  if (t < 0.75) return { background: '#DC2626', boxShadow: '0 0 6px rgba(244,63,94,0.35)' }
  if (t < 0.90) return { background: '#EF4444', boxShadow: '0 0 12px rgba(244,63,94,0.55)' }
  return               { background: '#FF3E6C', boxShadow: '0 0 20px rgba(244,63,94,0.85), 0 0 5px #FF3E6C' }
}

const HEATMAP_DAYS  = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת']
const HEATMAP_TIMES = ['בוקר', 'צהריים', 'ערב', 'לילה']

// ─── animation variants ───────────────────────────────────────────────────────

const stagger = { hidden: {}, visible: { transition: { staggerChildren: 0.08 } } }
const fadeUp  = {
  hidden:  { opacity: 0, y: 14 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.32, ease: [0.25, 0.46, 0.45, 0.94] } },
}

// ─── shared UI ────────────────────────────────────────────────────────────────

function DarkTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div style={S.tooltip}>
      <p style={S.tooltipLabel}>{label}</p>
      {payload.map((e) => (
        <p key={e.name} style={{ margin: '2px 0', color: e.color, fontSize: 13 }}>
          {e.name}: {fmtILS(e.value)}
        </p>
      ))}
    </div>
  )
}

function KpiCard({ title, value, sub, accent, cols }) {
  return (
    <motion.div
      variants={fadeUp}
      whileHover={{ y: -3, boxShadow: `0 0 24px ${accent}22` }}
      style={{ ...S.card, borderTopColor: accent, marginBottom: 0 }}
    >
      <p style={S.cardLabel}>{title}</p>
      <p style={{ ...S.cardValue, color: accent }}>{value}</p>
      {sub && <p style={S.cardSub}>{sub}</p>}
    </motion.div>
  )
}

function LinearProgress({ value, max, color }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0
  return (
    <div style={S.track}>
      <motion.div
        style={{ ...S.fill, background: color }}
        initial={{ width: 0 }}
        animate={{ width: `${pct}%` }}
        transition={{ duration: 1.1, ease: 'easeOut' }}
      />
    </div>
  )
}

function CircularProgress({ value, max, size = 64, stroke = 5, color = '#6366F1', children }) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const p = max > 0 ? Math.min(value / max, 1) : 0
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#27272A" strokeWidth={stroke} />
        <motion.circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color}
          strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - p) }}
          transition={{ duration: 1.2, ease: 'easeOut' }}
        />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {children}
      </div>
    </div>
  )
}

function SectionTitle({ children }) {
  return <p style={S.sectionTitle}>{children}</p>
}

function Empty({ msg }) {
  return <p style={S.empty}>{msg ?? 'אין נתונים'}</p>
}

function FilterRow({ children }) {
  return <div style={S.filterRow}>{children}</div>
}

function InsightsCard({ insights, loading }) {
  return (
    <motion.div variants={fadeUp} style={S.insightsCard}>
      <div style={S.insightsHead}>
        <span style={S.aiBadge}>AI</span>
        <SectionTitle>תובנות פיננסיות חכמות</SectionTitle>
      </div>
      {loading ? <Empty msg="טוען תובנות…" /> : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {insights.map((txt, i) => (
            <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, direction: 'rtl' }}>
              <span style={S.dot} />
              <span style={{ fontSize: 14, color: '#CBD5E1', lineHeight: 1.65 }}>{txt}</span>
            </li>
          ))}
        </ul>
      )}
    </motion.div>
  )
}

function GlowAiCard({ title, icon, insights, accentColor, loading }) {
  return (
    <motion.div variants={fadeUp} style={{ flex: 1, minWidth: 0 }}>
      <motion.div
        animate={{
          boxShadow: [
            `0 0 0 1px ${accentColor}22, 0 0 28px ${accentColor}14`,
            `0 0 0 1px ${accentColor}55, 0 0 56px ${accentColor}34`,
            `0 0 0 1px ${accentColor}22, 0 0 28px ${accentColor}14`,
          ],
        }}
        transition={{ duration: 3.8, repeat: Infinity, ease: 'easeInOut' }}
        style={{
          ...S.card, marginBottom: 0,
          border: `1px solid ${accentColor}40`,
          backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
        }}
      >
        <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:14, direction:'rtl' }}>
          <span style={{ fontSize:18, lineHeight:1 }}>{icon}</span>
          <p style={{ ...S.cardLabel, margin:0, color:accentColor, letterSpacing:'0.05em' }}>{title}</p>
          <span style={{ ...S.aiBadge, marginRight:'auto' }}>AI</span>
        </div>
        {loading ? <Empty msg="טוען…" /> : (
          <ul style={{ listStyle:'none', margin:0, padding:0, display:'flex', flexDirection:'column', gap:10 }}>
            {insights.map((txt, i) => (
              <li key={i} style={{ display:'flex', alignItems:'flex-start', gap:9, direction:'rtl' }}>
                <span style={{ width:5, height:5, borderRadius:'50%', background:accentColor, flexShrink:0, marginTop:7 }} />
                <span style={{ fontSize:13, color:'#CBD5E1', lineHeight:1.62 }}>{txt}</span>
              </li>
            ))}
          </ul>
        )}
      </motion.div>
    </motion.div>
  )
}

function SpendingHeatmap({ transactions, loading }) {
  const grid   = processSpendingHeatmap(transactions)
  const maxVal = Math.max(...grid.flat(), 1)
  const hasData = grid.flat().some(v => v > 0)

  return (
    <motion.div variants={fadeUp} style={{ ...S.card, marginTop: 16 }}>
      <p style={S.sectionTitle}>מפת חום התנהגותית</p>
      <p style={{ fontSize:10, color:'#374151', margin:'-10px 0 18px', letterSpacing:'0.02em' }}>
        הוצאות לפי יום בשבוע × שעת יום
      </p>
      {loading ? <Empty msg="טוען…" /> : !hasData ? <Empty msg="אין מספיק נתוני הוצאות" /> : (
        <div style={{ direction:'rtl' }}>
          {/* Header row */}
          <div style={{ display:'grid', gridTemplateColumns:'76px repeat(4,1fr)', gap:5, marginBottom:5 }}>
            <div />
            {HEATMAP_TIMES.map(t => (
              <div key={t} style={{ fontSize:10, color:'#4B5563', textAlign:'center', letterSpacing:'0.04em', textTransform:'uppercase' }}>{t}</div>
            ))}
          </div>
          {/* Data rows */}
          {HEATMAP_DAYS.map((day, di) => (
            <div key={day} style={{ display:'grid', gridTemplateColumns:'76px repeat(4,1fr)', gap:5, marginBottom:5 }}>
              <div style={{ fontSize:11, color:'#4B5563', display:'flex', alignItems:'center', justifyContent:'flex-end', paddingLeft:10 }}>
                {day}
              </div>
              {grid[di].map((val, ti) => {
                const cs = heatCellStyle(val, maxVal)
                return (
                  <motion.div
                    key={ti}
                    initial={{ opacity: 0, scale: 0.75 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: (di * 4 + ti) * 0.014, duration: 0.22 }}
                    title={val > 0 ? fmtILS(val) : '—'}
                    style={{
                      height: 30, borderRadius: 6,
                      background: cs.background,
                      boxShadow: cs.boxShadow,
                      transition: 'box-shadow 0.2s',
                    }}
                  />
                )
              })}
            </div>
          ))}
          {/* Scale legend */}
          <div style={{ display:'flex', alignItems:'center', gap:5, marginTop:12, justifyContent:'flex-end', direction:'ltr' }}>
            <span style={{ fontSize:10, color:'#374151', marginLeft:4 }}>נמוך</span>
            {['#161616','#2D1116','#7F1D1D','#B91C1C','#DC2626','#EF4444','#FF3E6C'].map((c, i) => (
              <div key={i} style={{ width:16, height:16, borderRadius:4, background:c }} />
            ))}
            <span style={{ fontSize:10, color:'#374151', marginRight:4 }}>גבוה</span>
          </div>
        </div>
      )}
    </motion.div>
  )
}

// ─── Overview ─────────────────────────────────────────────────────────────────

function OverviewView({ transactions, settings, loading, realAiInsights, aiLoading }) {
  const m        = nowMonthStr()
  const filtered = filterByMonth(transactions, m)
  const kpis     = processKpis(filtered)
  const insights = generateInsights(filtered, settings)
  const comp     = processMonthlyComparison(transactions, String(CURRENT_YEAR))
  const limit    = Number(settings.monthlyLimit) || 0

  // data for new analytical section
  const monthlyIns  = generateCurrentMonthInsights(filtered, settings)
  const holisticIns = generateHolisticInsights(transactions, settings)
  const cashflow    = processMultiYearCashflow(transactions)
  const budgetData  = processBudgetVsActual(transactions, m, limit)
  const hasCashflow = cashflow.length >= 2
  const radarData   = processSavingsRadar(settings)

  return (
    <motion.div variants={stagger} initial="hidden" animate="visible" style={S.view}>

      {/* ── KPI row (unchanged) ── */}
      <div style={{ ...S.kpiGrid, gridTemplateColumns: 'repeat(4,1fr)', marginBottom: 18 }}>
        <KpiCard title="הכנסות החודש"  value={loading ? '—' : fmtILS(kpis.income)}   accent="#10B981" sub={`${filtered.filter(t=>t.type==='income').length} עסקאות`} />
        <KpiCard title="הוצאות החודש"  value={loading ? '—' : fmtILS(kpis.expenses)} accent="#FF3E6C" sub={`${filtered.filter(t=>t.type==='expense').length} עסקאות`} />
        <KpiCard title="יתרה נקייה"    value={loading ? '—' : fmtILS(kpis.net)}      accent="#6366F1" sub={kpis.net >= 0 ? 'עודף' : 'גירעון'} />
        <KpiCard title="סה״כ עסקאות"   value={loading ? '—' : transactions.length}   accent="#06D6F7" sub="כל הזמנים" />
      </div>

      {/* ── NEW: AI Financial Assistant cards ── */}
      <div style={{ display:'flex', gap:16, marginBottom:16 }}>
        <GlowAiCard title="ניתוח קצב חודש נוכחי" icon="📊" insights={monthlyIns}  accentColor="#6366F1" loading={loading} />
        <GlowAiCard title="סקירה פיננסית כוללת"   icon="🔭" insights={realAiInsights.length > 0 ? realAiInsights : holisticIns} accentColor="#06D6F7" loading={loading || aiLoading} />
      </div>

      {/* ── existing InsightsCard (unchanged) ── */}
      <InsightsCard insights={insights} loading={loading} />

      {/* ── existing BarChart (unchanged) ── */}
      <motion.div variants={fadeUp} style={S.card}>
        <SectionTitle>השוואת הכנסות / הוצאות — {CURRENT_YEAR}</SectionTitle>
        {comp.every(d => !d.income && !d.expense) && !loading ? <Empty msg="אין נתונים לשנה זו" /> : (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={comp} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="#27272A" vertical={false} />
              <XAxis dataKey="month" tick={{ fill: '#4B5563', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#4B5563', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={v=>`₪${v}`} width={60} />
              <Tooltip content={<DarkTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
              <Legend wrapperStyle={{ fontSize: 12, color: '#4B5563', paddingTop: 8 }} />
              <Bar dataKey="income"  name="הכנסות" fill="#10B981" radius={[3,3,0,0]} />
              <Bar dataKey="expense" name="הוצאות" fill="#FF3E6C" radius={[3,3,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </motion.div>

      {/* ── NEW: Analytical Charts Grid ── */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:16 }}>

        {/* Chart 1: Temporal Cashflow — multi-line AreaChart */}
        <motion.div variants={fadeUp} style={{ ...S.card, marginBottom:0 }}>
          <p style={S.sectionTitle}>תזרים מזומנים טמפורלי</p>
          <p style={{ fontSize:10, color:'#374151', margin:'-10px 0 12px' }}>הכנסות / הוצאות / יתרה — 18 חודשים</p>
          {!hasCashflow && !loading ? <Empty msg="אין מספיק נתונים" /> : (
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={cashflow} margin={{ top:4, right:0, left:0, bottom:0 }}>
                <defs>
                  <linearGradient id="cfInc" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"   stopColor="#10B981" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#10B981" stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="cfExp" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"   stopColor="#FF3E6C" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#FF3E6C" stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="cfNet" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"   stopColor="#6366F1" stopOpacity={0.42} />
                    <stop offset="100%" stopColor="#6366F1" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#27272A" vertical={false} />
                <XAxis dataKey="label" tick={{ fill:'#4B5563', fontSize:9 }} axisLine={false} tickLine={false}
                  interval={Math.max(Math.floor(cashflow.length / 6) - 1, 0)} />
                <YAxis tick={{ fill:'#4B5563', fontSize:9 }} axisLine={false} tickLine={false}
                  tickFormatter={v=>`₪${(v/1000).toFixed(0)}K`} width={42} />
                <Tooltip content={<DarkTooltip />} />
                <Legend wrapperStyle={{ fontSize:9, color:'#4B5563', paddingTop:4 }} />
                <ReferenceLine y={0} stroke="rgba(255,255,255,0.07)" strokeDasharray="4 4" />
                <Area type="monotone" dataKey="income"  name="הכנסות"   stroke="#10B981" strokeWidth={1.5} fill="url(#cfInc)" />
                <Area type="monotone" dataKey="expense" name="הוצאות"   stroke="#FF3E6C" strokeWidth={1.5} fill="url(#cfExp)" />
                <Area type="monotone" dataKey="net"     name="יתרה נטו" stroke="#6366F1" strokeWidth={2}   fill="url(#cfNet)" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </motion.div>

        {/* Chart 2: Predictive Budget Variance — ComposedChart */}
        <motion.div variants={fadeUp} style={{ ...S.card, marginBottom:0 }}>
          <p style={S.sectionTitle}>סטיית תקציב ניבויית</p>
          <p style={{ fontSize:10, color:'#374151', margin:'-10px 0 12px' }}>בפועל vs תקציב — קטגוריות מובילות</p>
          {budgetData.length === 0 && !loading ? <Empty msg="אין הוצאות בחודש זה" /> : (
            <ResponsiveContainer width="100%" height={200}>
              <ComposedChart data={budgetData} margin={{ top:4, right:8, left:0, bottom:36 }}>
                <CartesianGrid stroke="#27272A" vertical={false} />
                <XAxis dataKey="name" tick={{ fill:'#64748B', fontSize:9 }} axisLine={false} tickLine={false}
                  angle={-28} textAnchor="end" />
                <YAxis tick={{ fill:'#4B5563', fontSize:9 }} axisLine={false} tickLine={false}
                  tickFormatter={v=>`₪${v}`} width={50} />
                <Tooltip content={<DarkTooltip />} cursor={{ fill:'rgba(255,255,255,0.025)' }} />
                <Legend wrapperStyle={{ fontSize:9, color:'#4B5563', paddingTop:4 }} />
                <Bar dataKey="actual" name="בפועל" radius={[3,3,0,0]} maxBarSize={30}>
                  {budgetData.map((e, i) => <Cell key={i} fill={e.over ? '#FF3E6C' : '#10B981'} />)}
                </Bar>
                <Line type="monotone" dataKey="budget" name="תקציב יעד"
                  stroke="#F59E0B" strokeWidth={2} strokeDasharray="5 3"
                  dot={{ r:3, fill:'#F59E0B', strokeWidth:0 }}
                  activeDot={{ r:5, fill:'#F59E0B', stroke:'rgba(245,158,11,0.35)', strokeWidth:5 }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </motion.div>

        {/* Chart 3: Savings Radar */}
        <motion.div variants={fadeUp} style={{ ...S.card, marginBottom:0 }}>
          <p style={S.sectionTitle}>רדאר קופות חיסכון</p>
          <p style={{ fontSize:10, color:'#374151', margin:'-10px 0 12px', letterSpacing:'0.02em' }}>% השגת יעד לכל קופה</p>
          {radarData.length === 0 && !loading ? <Empty msg="לא הוגדרו קופות חיסכון בהגדרות" /> : (
            <ResponsiveContainer width="100%" height={200}>
              <RadarChart data={radarData} margin={{ top:10, right:24, bottom:10, left:24 }}>
                <PolarGrid stroke="#27272A" />
                <PolarAngleAxis dataKey="subject" tick={{ fill:'#4B5563', fontSize:9 }} />
                <PolarRadiusAxis angle={90} domain={[0, 120]} tick={false} axisLine={false} />
                <Radar name="יעד" dataKey="target"
                  stroke="rgba(6,214,247,0.28)" strokeWidth={1}
                  fill="rgba(6,214,247,0.06)"
                />
                <Radar name="נוכחי" dataKey="current"
                  stroke="#06D6F7" strokeWidth={2}
                  fill="rgba(16,185,129,0.20)"
                  dot={{ r:3, fill:'#10B981', strokeWidth:0 }}
                />
                <Legend wrapperStyle={{ fontSize:9, color:'#4B5563', paddingTop:4 }} />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null
                    const d = radarData.find(r => r.subject === payload[0]?.payload?.subject)
                    if (!d) return null
                    return (
                      <div style={S.tooltip}>
                        <p style={S.tooltipLabel}>{d.subject}</p>
                        <p style={{ margin:'2px 0', color:'#10B981', fontSize:13 }}>נוכחי: {fmtILS(d.currentRaw)}</p>
                        <p style={{ margin:'2px 0', color:'#06D6F7', fontSize:13 }}>יעד: {fmtILS(d.targetRaw)}</p>
                      </div>
                    )
                  }}
                />
              </RadarChart>
            </ResponsiveContainer>
          )}
        </motion.div>

      </div>

      {/* Chart 4: Behavioral Spending Heatmap */}
      <SpendingHeatmap transactions={transactions} loading={loading} />

    </motion.div>
  )
}

// ─── Monthly ──────────────────────────────────────────────────────────────────

function MonthlyView({ transactions, settings, loading }) {
  const [month, setMonth] = useState(nowMonthStr)

  const filtered  = filterByMonth(transactions, month)
  const kpis      = processKpis(filtered)
  const byCat     = processByCategory(filtered)
  const limit     = Number(settings.monthlyLimit) || 0
  const pace      = calcPace(kpis.expenses, limit)
  const recurring = transactions.filter((t) => t.period === 'monthly')

  return (
    <motion.div variants={stagger} initial="hidden" animate="visible" style={S.view}>
      <FilterRow>
        <label style={S.filterLabel}>חודש</label>
        <input type="month" value={month} onChange={e => setMonth(e.target.value)} style={S.filterInput} />
      </FilterRow>

      <div style={{ ...S.kpiGrid, gridTemplateColumns: 'repeat(3,1fr)', marginBottom: 18 }}>
        <KpiCard title="הכנסות" value={loading ? '—' : fmtILS(kpis.income)}   accent="#10B981" sub="period: monthly" />
        <KpiCard title="הוצאות" value={loading ? '—' : fmtILS(kpis.expenses)} accent="#FF3E6C" sub="period: monthly" />
        <KpiCard title="יתרה"   value={loading ? '—' : fmtILS(kpis.net)}      accent="#6366F1" sub={kpis.net >= 0 ? 'עודף' : 'גירעון'} />
      </div>

      {/* Pace card */}
      <motion.div variants={fadeUp} style={{ ...S.card, borderTopColor: pace.color }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:14, direction:'rtl' }}>
          <div>
            <p style={S.cardLabel}>קצב הוצאות</p>
            <div style={{ display:'flex', alignItems:'center', gap:8, marginTop:4 }}>
              <span style={{ fontSize:20 }}>{pace.icon}</span>
              <span style={{ fontSize:17, fontWeight:700, color:pace.color }}>{pace.label}</span>
            </div>
          </div>
          <div style={{ textAlign:'left', direction:'ltr' }}>
            <p style={{ ...S.cardLabel, marginBottom:3 }}>יום {pace.day} / {pace.total}</p>
            <p style={{ fontSize:13, color:'#4B5563', margin:0 }}>
              צפי: {fmtILS(pace.expected)} | בפועל: <span style={{ color:pace.color }}>{fmtILS(kpis.expenses)}</span>
            </p>
          </div>
        </div>
        <div style={{ position:'relative' }}>
          <LinearProgress value={kpis.expenses} max={limit || 1} color={pace.color} />
          <div style={{ position:'absolute', top:0, bottom:0, left:`${(pace.day/pace.total)*100}%`, width:2, background:'rgba(255,255,255,0.18)', borderRadius:2 }} />
        </div>
        <div style={{ display:'flex', justifyContent:'space-between', marginTop:6, direction:'ltr' }}>
          <span style={{ fontSize:11, color:'#374151' }}>₪0</span>
          <span style={{ fontSize:11, color:'#374151' }}>מסגרת: {limit ? fmtILS(limit) : 'לא הוגדר'}</span>
        </div>
      </motion.div>

      {/* Category bar chart */}
      <motion.div variants={fadeUp} style={S.card}>
        <SectionTitle>הוצאות לפי קטגוריה</SectionTitle>
        {byCat.length === 0 && !loading ? <Empty msg="אין הוצאות בחודש זה" /> : (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={byCat} margin={{ top:4, right:0, left:0, bottom:36 }}>
              <CartesianGrid stroke="#27272A" vertical={false} />
              <XAxis dataKey="name" tick={{ fill:'#4B5563', fontSize:11 }} axisLine={false} tickLine={false} angle={-30} textAnchor="end" />
              <YAxis tick={{ fill:'#4B5563', fontSize:11 }} axisLine={false} tickLine={false} tickFormatter={v=>`₪${v}`} width={60} />
              <Tooltip content={<DarkTooltip />} cursor={{ fill:'rgba(139,92,246,0.06)' }} />
              <Bar dataKey="value" name="הוצאה" radius={[4,4,0,0]}>
                {byCat.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </motion.div>

      {/* Recurring transactions */}
      <motion.div variants={fadeUp} style={S.card}>
        <SectionTitle>עסקאות חוזרות ({recurring.length})</SectionTitle>
        {recurring.length === 0 && !loading ? <Empty msg="לא נמצאו עסקאות חוזרות" /> : (
          <div style={{ display:'flex', flexDirection:'column', gap:2 }}>
            {recurring.slice(0, 10).map((t, i) => (
              <div key={t.id ?? i} style={S.txRow}>
                <span style={{ ...S.txBadge, background: t.type==='income' ? 'rgba(16,185,129,0.12)' : 'rgba(244,63,94,0.12)', color: t.type==='income' ? '#10B981' : '#FF3E6C' }}>
                  {t.type === 'income' ? '↑' : '↓'}
                </span>
                <span style={S.txDesc}>{t.desc || t.category}</span>
                <span style={S.txCat}>{t.category}</span>
                <span style={{ ...S.txAmt, color: t.type==='income' ? '#10B981' : '#FF3E6C' }}>
                  {t.type==='income' ? '+' : '−'}{fmtILS(Number(t.amount)||0)}
                </span>
              </div>
            ))}
            {recurring.length > 10 && <p style={{ fontSize:12, color:'#374151', textAlign:'center', margin:'8px 0 0' }}>ועוד {recurring.length - 10}…</p>}
          </div>
        )}
      </motion.div>
    </motion.div>
  )
}

// ─── Annual ───────────────────────────────────────────────────────────────────

function AnnualView({ transactions, settings, loading }) {
  const [year, setYear] = useState(String(CURRENT_YEAR))

  const filtered     = filterByYear(transactions, year)
  const kpis         = processKpis(filtered)
  const pieData      = processByCategory(filtered)
  const yearlyGoal   = Number(settings.yearlyGoal) || 0
  const savingsGoals = settings.savingsGoals || []
  const savingsPct   = yearlyGoal > 0 ? Math.min((kpis.net / yearlyGoal) * 100, 100) : 0

  return (
    <motion.div variants={stagger} initial="hidden" animate="visible" style={S.view}>
      <FilterRow>
        <label style={S.filterLabel}>שנה</label>
        <select value={year} onChange={e => setYear(e.target.value)} style={S.filterInput}>
          {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
      </FilterRow>

      <div style={{ ...S.kpiGrid, gridTemplateColumns:'repeat(3,1fr)', marginBottom:18 }}>
        <KpiCard title="הכנסות שנתיות" value={loading ? '—' : fmtILS(kpis.income)}   accent="#10B981" sub={`${filtered.filter(t=>t.type==='income').length} עסקאות`} />
        <KpiCard title="הוצאות שנתיות" value={loading ? '—' : fmtILS(kpis.expenses)} accent="#FF3E6C" sub={`${filtered.filter(t=>t.type==='expense').length} עסקאות`} />
        <KpiCard title="חיסכון נטו"    value={loading ? '—' : fmtILS(kpis.net)}      accent="#6366F1" sub={`${Math.round(savingsPct)}% מהיעד`} />
      </div>

      {/* Annual goal */}
      <motion.div variants={fadeUp} style={S.card}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12, direction:'rtl' }}>
          <div>
            <p style={S.cardLabel}>יעד חיסכון שנתי</p>
            <p style={{ ...S.cardValue, color:'#6366F1', margin:'4px 0 0', fontSize:20 }}>{yearlyGoal ? fmtILS(yearlyGoal) : 'לא הוגדר'}</p>
          </div>
          <p style={{ fontSize:30, fontWeight:800, color:'#6366F1', margin:0, letterSpacing:'-0.04em' }}>{Math.round(savingsPct)}%</p>
        </div>
        <LinearProgress value={Math.max(kpis.net, 0)} max={yearlyGoal || 1} color="linear-gradient(90deg,#6366F1,#06D6F7)" />
        <p style={{ fontSize:11, color:'#374151', marginTop:6, textAlign:'left', direction:'ltr' }}>
          נותר: {yearlyGoal ? fmtILS(Math.max(yearlyGoal - kpis.net, 0)) : '—'}
        </p>
      </motion.div>

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:18 }}>
        {/* Savings goals */}
        <motion.div variants={fadeUp} style={{ ...S.card, marginBottom:0 }}>
          <SectionTitle>קופות חיסכון</SectionTitle>
          {savingsGoals.length === 0 ? <Empty msg="לא הוגדרו קופות חיסכון" /> : (
            <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
              {savingsGoals.map((fund, idx) => {
                const cur   = Number(fund.current) || 0
                const tgt   = Number(fund.target)  || 1
                const pct   = Math.min((cur/tgt)*100, 100)
                const color = PIE_COLORS[idx % PIE_COLORS.length]
                return (
                  <div key={fund.name ?? idx} style={{ display:'flex', alignItems:'center', gap:12, direction:'rtl' }}>
                    <CircularProgress value={cur} max={tgt} color={color}>
                      <span style={{ fontSize:10, fontWeight:700, color }}>{Math.round(pct)}%</span>
                    </CircularProgress>
                    <div style={{ flex:1 }}>
                      <div style={{ display:'flex', justifyContent:'space-between', marginBottom:5 }}>
                        <span style={{ fontSize:13, fontWeight:600, color:'#E2E8F0' }}>{fund.name}</span>
                        <span style={{ fontSize:11, color:'#475569' }}>{fmtILS(cur)} / {fmtILS(tgt)}</span>
                      </div>
                      <LinearProgress value={cur} max={tgt} color={color} />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </motion.div>

        {/* Pie chart */}
        <motion.div variants={fadeUp} style={{ ...S.card, marginBottom:0 }}>
          <SectionTitle>התפלגות הוצאות שנתית</SectionTitle>
          {pieData.length === 0 && !loading ? <Empty msg="אין הוצאות לשנה זו" /> : (
            <div style={{ display:'flex', gap:12, alignItems:'center', direction:'rtl' }}>
              <ResponsiveContainer width={160} height={160}>
                <PieChart>
                  <Pie data={pieData} cx="50%" cy="50%" innerRadius={44} outerRadius={72} paddingAngle={3} dataKey="value" strokeWidth={0}>
                    {pieData.map((_,i) => <Cell key={i} fill={PIE_COLORS[i%PIE_COLORS.length]} />)}
                  </Pie>
                  <Tooltip content={<DarkTooltip />} />
                </PieChart>
              </ResponsiveContainer>
              <div style={{ flex:1, display:'flex', flexDirection:'column', gap:7 }}>
                {pieData.slice(0,6).map((e,i) => (
                  <div key={e.name} style={{ display:'flex', alignItems:'center', gap:8, direction:'rtl' }}>
                    <span style={{ width:7, height:7, borderRadius:'50%', background:PIE_COLORS[i%PIE_COLORS.length], flexShrink:0 }} />
                    <span style={{ fontSize:12, color:'#94A3B8', flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{e.name}</span>
                    <span style={{ fontSize:12, color:'#475569', flexShrink:0 }}>{fmtILS(e.value)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </motion.div>
      </div>
    </motion.div>
  )
}

// ─── Reports ──────────────────────────────────────────────────────────────────

function ReportsView({ transactions, loading }) {
  const [year, setYear] = useState(String(CURRENT_YEAR))

  const filtered = filterByYear(transactions, year)
  const pieData  = processByCategory(filtered)
  const comp     = processMonthlyComparison(transactions, year)

  return (
    <motion.div variants={stagger} initial="hidden" animate="visible" style={S.view}>
      <FilterRow>
        <label style={S.filterLabel}>שנה</label>
        <select value={year} onChange={e => setYear(e.target.value)} style={S.filterInput}>
          {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
      </FilterRow>

      <motion.div variants={fadeUp} style={S.card}>
        <SectionTitle>השוואת הכנסות / הוצאות — {year}</SectionTitle>
        {comp.every(d => !d.income && !d.expense) && !loading ? <Empty msg="אין נתונים לשנה זו" /> : (
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={comp} margin={{ top:4, right:0, left:0, bottom:0 }}>
              <CartesianGrid stroke="#27272A" vertical={false} />
              <XAxis dataKey="month" tick={{ fill:'#4B5563', fontSize:11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill:'#4B5563', fontSize:11 }} axisLine={false} tickLine={false} tickFormatter={v=>`₪${v}`} width={60} />
              <Tooltip content={<DarkTooltip />} cursor={{ fill:'rgba(255,255,255,0.03)' }} />
              <Legend wrapperStyle={{ fontSize:12, color:'#4B5563', paddingTop:8 }} />
              <Bar dataKey="income"  name="הכנסות" fill="#10B981" radius={[3,3,0,0]} />
              <Bar dataKey="expense" name="הוצאות" fill="#FF3E6C" radius={[3,3,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </motion.div>

      <motion.div variants={fadeUp} style={S.card}>
        <SectionTitle>התפלגות הוצאות לפי קטגוריה — {year}</SectionTitle>
        {pieData.length === 0 && !loading ? <Empty msg="אין הוצאות לשנה זו" /> : (
          <div style={{ display:'flex', gap:32, alignItems:'center', justifyContent:'center', direction:'rtl' }}>
            <ResponsiveContainer width={220} height={220}>
              <PieChart>
                <Pie data={pieData} cx="50%" cy="50%" innerRadius={60} outerRadius={96} paddingAngle={3} dataKey="value" strokeWidth={0}>
                  {pieData.map((_,i) => <Cell key={i} fill={PIE_COLORS[i%PIE_COLORS.length]} />)}
                </Pie>
                <Tooltip content={<DarkTooltip />} />
              </PieChart>
            </ResponsiveContainer>
            <div style={{ display:'flex', flexDirection:'column', gap:10, minWidth:180 }}>
              {pieData.slice(0,7).map((e,i) => (
                <div key={e.name} style={{ display:'flex', alignItems:'center', gap:10, direction:'rtl' }}>
                  <span style={{ width:10, height:10, borderRadius:3, background:PIE_COLORS[i%PIE_COLORS.length], flexShrink:0 }} />
                  <span style={{ fontSize:13, color:'#94A3B8', flex:1 }}>{e.name}</span>
                  <span style={{ fontSize:13, fontWeight:600, color:'#E2E8F0' }}>{fmtILS(e.value)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </motion.div>
    </motion.div>
  )
}

// ─── Settings ─────────────────────────────────────────────────────────────────

function SettingsView({ settings }) {
  const goals = settings.savingsGoals || []
  return (
    <motion.div variants={stagger} initial="hidden" animate="visible" style={S.view}>
      <motion.div variants={fadeUp} style={S.card}>
        <SectionTitle>הגדרות תקציב</SectionTitle>
        <div style={{ display:'flex', flexDirection:'column', gap:10, direction:'rtl' }}>
          {[
            ['מסגרת חודשית',    settings.monthlyLimit ? fmtILS(settings.monthlyLimit) : 'לא הוגדר'],
            ['יעד חיסכון שנתי', settings.yearlyGoal   ? fmtILS(settings.yearlyGoal)   : 'לא הוגדר'],
          ].map(([label, val]) => (
            <div key={label} style={S.settingRow}>
              <span style={{ fontSize:13, color:'#4B5563' }}>{label}</span>
              <span style={{ fontSize:15, fontWeight:600, color:'#E2E8F0' }}>{val}</span>
            </div>
          ))}
        </div>
      </motion.div>

      {goals.length > 0 && (
        <motion.div variants={fadeUp} style={S.card}>
          <SectionTitle>קופות חיסכון</SectionTitle>
          <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
            {goals.map((g, i) => (
              <div key={g.name ?? i} style={S.settingRow}>
                <span style={{ fontSize:14, color:'#E2E8F0' }}>{g.name}</span>
                <span style={{ fontSize:13, color:'#4B5563' }}>{fmtILS(Number(g.current)||0)} / {fmtILS(Number(g.target)||0)}</span>
              </div>
            ))}
          </div>
        </motion.div>
      )}
    </motion.div>
  )
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────

const VIEW_LABELS = {
  overview: 'סקירה כללית',
  monthly:  'ניהול שוטף',
  annual:   'מבט שנתי',
  reports:  'דוחות',
  settings: 'הגדרות',
}

export default function Dashboard({ user, onLogout }) {
  const [transactions, setTransactions]     = useState([])
  const [settings, setSettings]             = useState({})
  const [loading, setLoading]               = useState(true)
  const [error, setError]                   = useState(null)
  const [activeView, setActiveView]         = useState('overview')
  const [realAiInsights, setRealAiInsights] = useState([])
  const [aiLoading, setAiLoading]           = useState(false)

  async function fetchData() {
    setLoading(true)
    setError(null)
    try {
      const cu   = auth.currentUser
      const inv  = await getDoc(doc(db, 'invitations', cu.email))
      const gid  = inv.exists() ? inv.data().ownerId : cu.uid

      const [txSnap, cfgSnap] = await Promise.all([
        getDocs(collection(db, 'users', gid, 'transactions')),
        getDoc(doc(db, 'users', gid, 'config', 'settings')),
      ])

      const data = txSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
      console.log('Fetched Data:', data)
      setTransactions(data)
      if (cfgSnap.exists()) setSettings(cfgSnap.data())
    } catch (err) {
      setError(err.message ?? 'שגיאה בטעינת הנתונים.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
    const id = setInterval(fetchData, 60000)
    return () => clearInterval(id)
  }, [])

  // Debounced AI insights — re-fires 800 ms after transactions stabilise
  useEffect(() => {
    if (!transactions.length) return
    setAiLoading(true)
    const id = setTimeout(() => {
      fetchAiInsights(transactions, settings)
        .then(setRealAiInsights)
        .catch(() => {})
        .finally(() => setAiLoading(false))
    }, 800)
    return () => clearTimeout(id)
  }, [transactions])

  return (
    <div style={S.root}>
      {/* Sidebar */}
      <aside style={S.sidebar}>
        <div style={S.logo}>
          <span style={S.logoMark}>S</span>
          <span style={S.logoText}>StashPro</span>
        </div>
        <nav style={S.nav}>
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              style={{ ...S.navBtn, ...(activeView === item.id ? S.navBtnActive : {}) }}
              onClick={() => setActiveView(item.id)}
            >
              {activeView === item.id && (
                <motion.div layoutId="navPill" style={S.navPill}
                  transition={{ type:'spring', bounce:0.15, duration:0.38 }} />
              )}
              <span style={{ ...S.navIcon, position:'relative', zIndex:1 }}>{item.icon}</span>
              <span style={{ position:'relative', zIndex:1 }}>{item.label}</span>
            </button>
          ))}
        </nav>
      </aside>

      {/* Main */}
      <main style={S.main}>
        <header style={S.header}>
          <div>
            <p style={S.headerSub}>StashPro Dashboard</p>
            <h1 style={S.headerTitle}>{VIEW_LABELS[activeView]}</h1>
          </div>
          <div style={S.headerActions}>
            <button style={{ ...S.actionBtn, opacity: loading ? 0.6 : 1 }} onClick={fetchData} disabled={loading}>
              {loading ? '⟳ טוען…' : '⟳ רענן'}
            </button>
            {onLogout && <button style={S.logoutBtn} onClick={onLogout}>התנתק</button>}
            <div style={S.avatar} title={user?.email}>{user?.email?.[0]?.toUpperCase() ?? 'U'}</div>
          </div>
        </header>

        {error && <div style={S.errorBanner}><span>⚠</span><span>{error}</span></div>}

        <AnimatePresence mode="wait">
          <motion.div key={activeView}
            initial={{ opacity:0, y:8 }} animate={{ opacity:1, y:0 }}
            exit={{ opacity:0, y:-6 }} transition={{ duration:0.18 }}
          >
            {activeView === 'overview' && <OverviewView transactions={transactions} settings={settings} loading={loading} realAiInsights={realAiInsights} aiLoading={aiLoading} />}
            {activeView === 'monthly'  && <MonthlyView  transactions={transactions} settings={settings} loading={loading} />}
            {activeView === 'annual'   && <AnnualView   transactions={transactions} settings={settings} loading={loading} />}
            {activeView === 'reports'  && <ReportsView  transactions={transactions} loading={loading} />}
            {activeView === 'settings' && <SettingsView settings={settings} />}
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  )
}

// ─── styles ───────────────────────────────────────────────────────────────────

const S = {
  root: { display:'flex', minHeight:'100vh', background:'transparent', color:'#F8FAFC', fontFamily:"'Inter','Segoe UI',sans-serif", direction:'rtl' },
  sidebar: { width:228, flexShrink:0, background:'rgba(5,7,20,0.88)', backdropFilter:'blur(24px)', WebkitBackdropFilter:'blur(24px)', borderLeft:'1px solid rgba(255,255,255,0.07)', display:'flex', flexDirection:'column', padding:'24px 0', boxShadow:'3px 0 30px rgba(0,0,0,0.4)' },
  logo: { display:'flex', alignItems:'center', gap:10, padding:'0 18px 24px', borderBottom:'1px solid rgba(255,255,255,0.06)', direction:'rtl' },
  logoMark: { width:32, height:32, borderRadius:9, background:'linear-gradient(135deg,#6366F1,#06D6F7)', display:'flex', alignItems:'center', justifyContent:'center', fontWeight:800, fontSize:15, flexShrink:0, color:'#fff', boxShadow:'0 0 18px rgba(99,102,241,0.5)' },
  logoText: { fontWeight:800, fontSize:15, letterSpacing:'-0.03em', color:'#F8FAFC' },
  nav: { display:'flex', flexDirection:'column', gap:2, padding:'14px 10px' },
  navBtn: { position:'relative', display:'flex', alignItems:'center', gap:9, padding:'10px 12px', borderRadius:10, border:'none', background:'transparent', color:'#475569', fontSize:13, fontWeight:500, cursor:'pointer', textAlign:'right', direction:'rtl', width:'100%', transition:'color 0.15s' },
  navBtnActive: { color:'#F8FAFC' },
  navPill: { position:'absolute', inset:0, borderRadius:10, background:'rgba(99,102,241,0.15)', border:'1px solid rgba(99,102,241,0.28)', boxShadow:'0 0 14px rgba(99,102,241,0.12)' },
  navIcon: { fontSize:14 },
  main: { flex:1, display:'flex', flexDirection:'column', padding:'36px 44px', direction:'rtl', overflowX:'hidden' },
  header: { display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:28 },
  headerSub: { fontSize:10, color:'#334155', margin:'0 0 4px', letterSpacing:'0.10em', textTransform:'uppercase' },
  headerTitle: { fontSize:24, fontWeight:800, margin:0, letterSpacing:'-0.04em', color:'#F8FAFC' },
  headerActions: { display:'flex', alignItems:'center', gap:10 },
  actionBtn: { padding:'8px 16px', borderRadius:9, border:'1px solid rgba(255,255,255,0.08)', background:'rgba(255,255,255,0.05)', backdropFilter:'blur(12px)', color:'#94A3B8', fontSize:12, fontWeight:500, cursor:'pointer' },
  logoutBtn: { padding:'8px 16px', borderRadius:9, border:'1px solid rgba(255,255,255,0.06)', background:'transparent', color:'#334155', fontSize:12, fontWeight:500, cursor:'pointer' },
  avatar: { width:34, height:34, borderRadius:'50%', background:'linear-gradient(135deg,#6366F1,#06D6F7)', display:'flex', alignItems:'center', justifyContent:'center', fontWeight:700, fontSize:14, flexShrink:0, color:'#fff', boxShadow:'0 0 16px rgba(99,102,241,0.45)' },
  errorBanner: { display:'flex', alignItems:'center', gap:10, background:'rgba(255,62,108,0.10)', border:'1px solid rgba(255,62,108,0.25)', borderRadius:10, padding:'10px 16px', marginBottom:20, color:'#FCA5A5', fontSize:13 },
  view: { display:'flex', flexDirection:'column' },
  kpiGrid: { display:'grid', gap:14 },
  card: { background:'rgba(255,255,255,0.04)', backdropFilter:'blur(12px)', WebkitBackdropFilter:'blur(12px)', border:'1px solid rgba(255,255,255,0.08)', borderTop:'2px solid transparent', borderRadius:14, padding:'20px 22px', marginBottom:16, cursor:'default', transition:'box-shadow 0.2s, background 0.2s' },
  cardLabel: { fontSize:10, color:'#475569', textTransform:'uppercase', letterSpacing:'0.09em', margin:'0 0 7px' },
  cardValue: { fontSize:26, fontWeight:800, margin:'0 0 3px', letterSpacing:'-0.04em', lineHeight:1 },
  cardSub: { fontSize:11, color:'#334155', margin:0 },
  sectionTitle: { fontSize:10, fontWeight:700, color:'#475569', margin:'0 0 14px', letterSpacing:'0.08em', textTransform:'uppercase' },
  empty: { fontSize:13, color:'#334155', textAlign:'center', padding:'36px 0', margin:0 },
  filterRow: { display:'flex', alignItems:'center', gap:10, marginBottom:18, direction:'rtl' },
  filterLabel: { fontSize:12, color:'#475569' },
  filterInput: { padding:'7px 12px', borderRadius:8, border:'1px solid rgba(255,255,255,0.08)', background:'rgba(255,255,255,0.05)', backdropFilter:'blur(8px)', color:'#F8FAFC', fontSize:13, outline:'none', cursor:'pointer', colorScheme:'dark' },
  track: { height:6, borderRadius:3, background:'rgba(255,255,255,0.06)', overflow:'hidden' },
  fill:  { height:'100%', borderRadius:3 },
  txRow: { display:'flex', alignItems:'center', gap:9, direction:'rtl', padding:'9px 10px', borderRadius:8, borderBottom:'1px solid rgba(255,255,255,0.04)' },
  txBadge: { width:26, height:26, borderRadius:7, flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center', fontSize:12, fontWeight:700 },
  txDesc: { flex:1, fontSize:13, color:'#CBD5E1', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' },
  txCat:  { fontSize:11, color:'#374151', padding:'2px 8px', borderRadius:5, background:'rgba(255,255,255,0.05)' },
  txAmt:  { fontSize:13, fontWeight:700, flexShrink:0, direction:'ltr' },
  settingRow: { display:'flex', justifyContent:'space-between', alignItems:'center', padding:'10px 14px', background:'rgba(255,255,255,0.04)', borderRadius:9, border:'1px solid rgba(255,255,255,0.06)' },
  tooltip: { background:'rgba(5,7,20,0.95)', backdropFilter:'blur(16px)', border:'1px solid rgba(255,255,255,0.10)', borderRadius:10, padding:'8px 12px', fontSize:13, color:'#E2E8F0' },
  tooltipLabel: { margin:'0 0 4px', color:'#334155', fontSize:10, textTransform:'uppercase', letterSpacing:'0.07em' },
  insightsCard: { background:'rgba(99,102,241,0.07)', backdropFilter:'blur(12px)', border:'1px solid rgba(99,102,241,0.22)', borderRadius:14, padding:'20px 22px', marginBottom:16, boxShadow:'0 0 0 1px rgba(99,102,241,0.07), 0 0 50px rgba(99,102,241,0.07)' },
  insightsHead: { display:'flex', alignItems:'center', gap:9, marginBottom:14, direction:'rtl' },
  aiBadge: { fontSize:9, fontWeight:800, letterSpacing:'0.12em', border:'1px solid rgba(99,102,241,0.40)', borderRadius:5, padding:'2px 6px', background:'linear-gradient(135deg,#6366F1,#06D6F7)', WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent', flexShrink:0 },
  dot: { width:6, height:6, borderRadius:'50%', background:'linear-gradient(135deg,#6366F1,#06D6F7)', flexShrink:0, marginTop:7 },
}
