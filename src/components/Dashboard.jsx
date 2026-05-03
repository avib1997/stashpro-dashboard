import { useEffect, useState } from 'react'
import { collection, doc, getDocs, getDoc } from 'firebase/firestore'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ResponsiveContainer, BarChart, Bar,
  PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from 'recharts'
import { auth, db } from '../firebase'

// ─── constants ────────────────────────────────────────────────────────────────

const PIE_COLORS    = ['#06B6D4', '#10B981', '#F43F5E', '#F59E0B', '#8B5CF6', '#EC4899', '#3B82F6']
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
  if (spent > limit)    return { icon: '🚨', label: 'חריגה מהמסגרת', color: '#F43F5E', expected, day, total, spentPct }
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

function CircularProgress({ value, max, size = 64, stroke = 5, color = '#8B5CF6', children }) {
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

// ─── Overview ─────────────────────────────────────────────────────────────────

function OverviewView({ transactions, settings, loading }) {
  const m        = nowMonthStr()
  const filtered = filterByMonth(transactions, m)
  const kpis     = processKpis(filtered)
  const insights = generateInsights(filtered, settings)
  const comp     = processMonthlyComparison(transactions, String(CURRENT_YEAR))

  return (
    <motion.div variants={stagger} initial="hidden" animate="visible" style={S.view}>
      <div style={{ ...S.kpiGrid, gridTemplateColumns: 'repeat(4,1fr)', marginBottom: 18 }}>
        <KpiCard title="הכנסות החודש"  value={loading ? '—' : fmtILS(kpis.income)}   accent="#10B981" sub={`${filtered.filter(t=>t.type==='income').length} עסקאות`} />
        <KpiCard title="הוצאות החודש"  value={loading ? '—' : fmtILS(kpis.expenses)} accent="#F43F5E" sub={`${filtered.filter(t=>t.type==='expense').length} עסקאות`} />
        <KpiCard title="יתרה נקייה"    value={loading ? '—' : fmtILS(kpis.net)}      accent="#8B5CF6" sub={kpis.net >= 0 ? 'עודף' : 'גירעון'} />
        <KpiCard title="סה״כ עסקאות"   value={loading ? '—' : transactions.length}   accent="#06B6D4" sub="כל הזמנים" />
      </div>

      <InsightsCard insights={insights} loading={loading} />

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
              <Bar dataKey="expense" name="הוצאות" fill="#F43F5E" radius={[3,3,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </motion.div>
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
        <KpiCard title="הוצאות" value={loading ? '—' : fmtILS(kpis.expenses)} accent="#F43F5E" sub="period: monthly" />
        <KpiCard title="יתרה"   value={loading ? '—' : fmtILS(kpis.net)}      accent="#8B5CF6" sub={kpis.net >= 0 ? 'עודף' : 'גירעון'} />
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
                <span style={{ ...S.txBadge, background: t.type==='income' ? 'rgba(16,185,129,0.12)' : 'rgba(244,63,94,0.12)', color: t.type==='income' ? '#10B981' : '#F43F5E' }}>
                  {t.type === 'income' ? '↑' : '↓'}
                </span>
                <span style={S.txDesc}>{t.desc || t.category}</span>
                <span style={S.txCat}>{t.category}</span>
                <span style={{ ...S.txAmt, color: t.type==='income' ? '#10B981' : '#F43F5E' }}>
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
        <KpiCard title="הוצאות שנתיות" value={loading ? '—' : fmtILS(kpis.expenses)} accent="#F43F5E" sub={`${filtered.filter(t=>t.type==='expense').length} עסקאות`} />
        <KpiCard title="חיסכון נטו"    value={loading ? '—' : fmtILS(kpis.net)}      accent="#8B5CF6" sub={`${Math.round(savingsPct)}% מהיעד`} />
      </div>

      {/* Annual goal */}
      <motion.div variants={fadeUp} style={S.card}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12, direction:'rtl' }}>
          <div>
            <p style={S.cardLabel}>יעד חיסכון שנתי</p>
            <p style={{ ...S.cardValue, color:'#8B5CF6', margin:'4px 0 0', fontSize:20 }}>{yearlyGoal ? fmtILS(yearlyGoal) : 'לא הוגדר'}</p>
          </div>
          <p style={{ fontSize:30, fontWeight:800, color:'#8B5CF6', margin:0, letterSpacing:'-0.04em' }}>{Math.round(savingsPct)}%</p>
        </div>
        <LinearProgress value={Math.max(kpis.net, 0)} max={yearlyGoal || 1} color="linear-gradient(90deg,#8B5CF6,#06B6D4)" />
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
              <Bar dataKey="expense" name="הוצאות" fill="#F43F5E" radius={[3,3,0,0]} />
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
  const [transactions, setTransactions] = useState([])
  const [settings, setSettings]         = useState({})
  const [loading, setLoading]           = useState(true)
  const [error, setError]               = useState(null)
  const [activeView, setActiveView]     = useState('overview')

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
            {activeView === 'overview' && <OverviewView transactions={transactions} settings={settings} loading={loading} />}
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
  root: { display:'flex', minHeight:'100vh', background:'#0F0F11', color:'#E2E8F0', fontFamily:"'Inter','Segoe UI',sans-serif", direction:'rtl' },
  sidebar: { width:220, flexShrink:0, background:'rgba(15,15,17,0.97)', backdropFilter:'blur(20px)', WebkitBackdropFilter:'blur(20px)', borderLeft:'1px solid rgba(255,255,255,0.05)', display:'flex', flexDirection:'column', padding:'24px 0' },
  logo: { display:'flex', alignItems:'center', gap:10, padding:'0 18px 22px', borderBottom:'1px solid rgba(255,255,255,0.05)', direction:'rtl' },
  logoMark: { width:30, height:30, borderRadius:8, background:'linear-gradient(135deg,#8B5CF6,#06B6D4)', display:'flex', alignItems:'center', justifyContent:'center', fontWeight:700, fontSize:14, flexShrink:0, color:'#fff' },
  logoText: { fontWeight:700, fontSize:14, letterSpacing:'-0.02em', color:'#F1F5F9' },
  nav: { display:'flex', flexDirection:'column', gap:2, padding:'14px 10px' },
  navBtn: { position:'relative', display:'flex', alignItems:'center', gap:9, padding:'9px 12px', borderRadius:9, border:'none', background:'transparent', color:'#4B5563', fontSize:13, fontWeight:500, cursor:'pointer', textAlign:'right', direction:'rtl', width:'100%', transition:'color 0.15s' },
  navBtnActive: { color:'#E2E8F0' },
  navPill: { position:'absolute', inset:0, borderRadius:9, background:'rgba(139,92,246,0.13)', border:'1px solid rgba(139,92,246,0.22)' },
  navIcon: { fontSize:14 },
  main: { flex:1, display:'flex', flexDirection:'column', padding:'34px 42px', direction:'rtl', overflowX:'hidden' },
  header: { display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:26 },
  headerSub: { fontSize:10, color:'#374151', margin:'0 0 3px', letterSpacing:'0.08em', textTransform:'uppercase' },
  headerTitle: { fontSize:22, fontWeight:700, margin:0, letterSpacing:'-0.03em', color:'#F1F5F9' },
  headerActions: { display:'flex', alignItems:'center', gap:10 },
  actionBtn: { padding:'7px 14px', borderRadius:8, border:'1px solid rgba(255,255,255,0.07)', background:'rgba(30,30,30,0.9)', color:'#94A3B8', fontSize:12, fontWeight:500, cursor:'pointer' },
  logoutBtn: { padding:'7px 14px', borderRadius:8, border:'1px solid rgba(255,255,255,0.06)', background:'transparent', color:'#374151', fontSize:12, fontWeight:500, cursor:'pointer' },
  avatar: { width:33, height:33, borderRadius:'50%', background:'linear-gradient(135deg,#8B5CF6,#06B6D4)', display:'flex', alignItems:'center', justifyContent:'center', fontWeight:600, fontSize:13, flexShrink:0, color:'#fff' },
  errorBanner: { display:'flex', alignItems:'center', gap:10, background:'#1a0505', border:'1px solid rgba(244,63,94,0.3)', borderRadius:10, padding:'10px 16px', marginBottom:20, color:'#FCA5A5', fontSize:13 },
  view: { display:'flex', flexDirection:'column' },
  kpiGrid: { display:'grid', gap:14 },
  card: { background:'#1E1E1E', border:'1px solid rgba(255,255,255,0.055)', borderTop:'2px solid transparent', borderRadius:12, padding:'18px 20px', marginBottom:16, cursor:'default', transition:'box-shadow 0.2s' },
  cardLabel: { fontSize:10, color:'#4B5563', textTransform:'uppercase', letterSpacing:'0.09em', margin:'0 0 7px' },
  cardValue: { fontSize:24, fontWeight:700, margin:'0 0 3px', letterSpacing:'-0.03em', lineHeight:1 },
  cardSub: { fontSize:11, color:'#374151', margin:0 },
  sectionTitle: { fontSize:11, fontWeight:600, color:'#4B5563', margin:'0 0 14px', letterSpacing:'0.05em', textTransform:'uppercase' },
  empty: { fontSize:13, color:'#374151', textAlign:'center', padding:'36px 0', margin:0 },
  filterRow: { display:'flex', alignItems:'center', gap:10, marginBottom:18, direction:'rtl' },
  filterLabel: { fontSize:12, color:'#4B5563' },
  filterInput: { padding:'6px 11px', borderRadius:7, border:'1px solid rgba(255,255,255,0.08)', background:'#1E1E1E', color:'#E2E8F0', fontSize:13, outline:'none', cursor:'pointer', colorScheme:'dark' },
  track: { height:6, borderRadius:3, background:'rgba(255,255,255,0.05)', overflow:'hidden' },
  fill:  { height:'100%', borderRadius:3 },
  txRow: { display:'flex', alignItems:'center', gap:9, direction:'rtl', padding:'8px 10px', borderRadius:7, borderBottom:'1px solid rgba(255,255,255,0.03)' },
  txBadge: { width:24, height:24, borderRadius:6, flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center', fontSize:12, fontWeight:700 },
  txDesc: { flex:1, fontSize:13, color:'#CBD5E1', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' },
  txCat:  { fontSize:11, color:'#374151', padding:'2px 7px', borderRadius:4, background:'rgba(255,255,255,0.04)' },
  txAmt:  { fontSize:13, fontWeight:600, flexShrink:0, direction:'ltr' },
  settingRow: { display:'flex', justifyContent:'space-between', alignItems:'center', padding:'9px 13px', background:'rgba(255,255,255,0.03)', borderRadius:8, border:'1px solid rgba(255,255,255,0.04)' },
  tooltip: { background:'#161618', border:'1px solid rgba(255,255,255,0.07)', borderRadius:8, padding:'8px 12px', fontSize:13, color:'#E2E8F0' },
  tooltipLabel: { margin:'0 0 4px', color:'#374151', fontSize:11, textTransform:'uppercase', letterSpacing:'0.06em' },
  insightsCard: { background:'#1E1E1E', border:'1px solid rgba(139,92,246,0.3)', borderRadius:12, padding:'18px 20px', marginBottom:16, boxShadow:'0 0 0 1px rgba(139,92,246,0.08), 0 0 40px rgba(139,92,246,0.06)' },
  insightsHead: { display:'flex', alignItems:'center', gap:9, marginBottom:14, direction:'rtl' },
  aiBadge: { fontSize:9, fontWeight:800, letterSpacing:'0.1em', border:'1px solid rgba(139,92,246,0.38)', borderRadius:5, padding:'2px 6px', background:'linear-gradient(135deg,#8B5CF6,#06B6D4)', WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent', flexShrink:0 },
  dot: { width:6, height:6, borderRadius:'50%', background:'linear-gradient(135deg,#8B5CF6,#06B6D4)', flexShrink:0, marginTop:7 },
}
