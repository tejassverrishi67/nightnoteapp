import { useState, useEffect, useRef, useCallback } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import {
  generateMission,
  generateLocalTasks,
  setSessionGroqApiKey,
  smartTrim as groqSmartTrim,
  generateWeeklySummary,
  sortTasksByPriority,
  TaskItem,
} from './services/groqService'
import { getStats, saveStats, incrementNotes, recordMissionComplete, recordTaskActivity, ProgressStats, DEFAULT_STATS } from './stats'
import { getSettings, saveSettings } from './settings'
import { VoiceSession } from './services/voiceService'

// ─── Configuration ─────────────────────────────────────────────────────────────
// Set to true for dev/testing demo mode (ignores time/date locks, enables infinite repeatable workflows).
// Set to false for strict production behavior.
export const DEMO_MODE = true

// ─── Types ────────────────────────────────────────────────────────────────────

type Screen = 'night' | 'morning' | 'progress' | 'settings'
type Priority = 'high' | 'medium' | 'low'

interface Task {
  id: string
  text: string
  priority: Priority
  duration: string
  done: boolean
}

// ─── Theme ────────────────────────────────────────────────────────────────────

const night = {
  bg: '#0d1b3e',
  surface: '#162150',
  surfaceAlt: '#1c2a63',
  accent: '#f5c842',
  text: '#e8eaf6',
  textDim: 'rgba(232,234,246,0.55)',
  border: 'rgba(245,200,66,0.18)',
}

const lightDayTheme = {
  bg: '#f7f4ee',
  surface: '#ffffff',
  surfaceAlt: '#f0ece2',
  accent: '#e8903a',
  accentDim: 'rgba(232,144,58,0.12)',
  text: '#1a1714',
  textDim: '#8a7e72',
  border: '#e4ddd0',
  green: '#3bb06d',
  greenBg: 'rgba(59,176,109,0.1)',
  yellow: '#d4a017',
  yellowBg: 'rgba(212,160,23,0.1)',
  red: '#d44a3a',
  redBg: 'rgba(212,74,58,0.1)',
}

const darkDayTheme = {
  bg: '#0f172a',
  surface: '#1e293b',
  surfaceAlt: '#334155',
  accent: '#f5c842',
  accentDim: 'rgba(245,200,66,0.15)',
  text: '#f8fafc',
  textDim: '#94a3b8',
  border: '#334155',
  green: '#10b981',
  greenBg: 'rgba(16,185,129,0.15)',
  yellow: '#f5c842',
  yellowBg: 'rgba(245,200,66,0.15)',
  red: '#ef4444',
  redBg: 'rgba(239,68,68,0.15)',
}

export type DayTheme = typeof lightDayTheme

export function getDayTheme(isDark: boolean): DayTheme {
  return isDark ? darkDayTheme : lightDayTheme
}

// Default day theme fallback
const day = lightDayTheme

// ─── Helpers ──────────────────────────────────────────────────────────────────

const priorityStyle = (p: Priority, theme: DayTheme = day) => {
  if (p === 'high') return { border: theme.green, bg: theme.greenBg, dot: theme.green, label: 'High' }
  if (p === 'medium') return { border: theme.yellow, bg: theme.yellowBg, dot: theme.yellow, label: 'Medium' }
  return { border: theme.red, bg: theme.redBg, dot: theme.red, label: 'Low' }
}

// ─── Confetti ─────────────────────────────────────────────────────────────────

const CONFETTI_COLORS = ['#f5c842', '#3bb06d', '#5b6af7', '#e8903a', '#f472b6', '#34d399']

function Confetti() {
  const pieces = Array.from({ length: 28 }, (_, i) => ({
    id: i,
    color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
    left: `${5 + (i * 3.3) % 90}%`,
    delay: `${(i * 0.11) % 1.4}s`,
    duration: `${1.6 + (i % 5) * 0.18}s`,
    size: 5 + (i % 4) * 3,
    shape: i % 3,
  }))

  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
      {pieces.map((p) => (
        <div
          key={p.id}
          style={{
            position: 'absolute',
            top: '-10px',
            left: p.left,
            width: p.size,
            height: p.shape === 2 ? p.size * 2 : p.size,
            background: p.color,
            borderRadius: p.shape === 0 ? '50%' : p.shape === 1 ? '2px' : '1px',
            animation: `confettiFall ${p.duration} ${p.delay} ease-in forwards`,
            opacity: 0.9,
          }}
        />
      ))}
    </div>
  )
}

// ─── AI Loading Overlay ───────────────────────────────────────────────────────

const AI_MESSAGES = [
  'Analyzing your thoughts…',
  'Prioritizing tomorrow\'s mission…',
  'Preparing your day…',
  'Crafting your plan…',
]

function AILoadingOverlay() {
  const [msgIdx, setMsgIdx] = useState(0)

  useEffect(() => {
    const t = setInterval(() => setMsgIdx((i) => (i + 1) % AI_MESSAGES.length), 1100)
    return () => clearInterval(t)
  }, [])

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: 'rgba(7,14,36,0.92)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 50,
        animation: 'overlayIn 0.3s ease',
      }}
    >
      {/* Groq AI spinner */}
      <div style={{ position: 'relative', width: '80px', height: '80px', marginBottom: '32px' }}>
        <div
          style={{
            width: '80px',
            height: '80px',
            borderRadius: '50%',
            border: '2px solid rgba(245,200,66,0.12)',
            position: 'absolute',
          }}
        />
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              width: '10px',
              height: '10px',
              marginTop: '-5px',
              marginLeft: '-5px',
              borderRadius: '50%',
              background: CONFETTI_COLORS[i],
              animation: `groqOrbit ${1.4 + i * 0.15}s ${i * 0.22}s linear infinite`,
              transformOrigin: '5px 5px',
            }}
          />
        ))}
        <div
          style={{
            position: 'absolute',
            inset: '20px',
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(245,200,66,0.15) 0%, transparent 70%)',
            animation: 'glowPulse 1.8s ease-in-out infinite',
          }}
        />
        <svg
          viewBox="0 0 24 24"
          style={{ position: 'absolute', inset: '26px', fill: night.accent }}
        >
          <path d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79z" />
        </svg>
      </div>

      {/* Animated message */}
      <div style={{ height: '28px', overflow: 'hidden', position: 'relative' }}>
        <p
          key={msgIdx}
          style={{
            fontFamily: "'Outfit', sans-serif",
            fontWeight: 600,
            fontSize: '16px',
            color: night.text,
            textAlign: 'center',
            animation: 'loadingMessage 1.1s ease forwards',
          }}
        >
          {AI_MESSAGES[msgIdx]}
        </p>
      </div>

      {/* Shimmer dots */}
      <div style={{ display: 'flex', gap: '8px', marginTop: '20px' }}>
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              background: night.accent,
              animation: `shimmerDot 1.2s ${i * 0.2}s ease-in-out infinite`,
            }}
          />
        ))}
      </div>
    </div>
  )
}

// ─── Mission Ready Modal ──────────────────────────────────────────────────────

function MissionReadyModal({
  onClose,
  onEditThoughts,
}: {
  onClose: () => void
  onEditThoughts: () => void
}) {
  const stars = [
    { x: 52, y: 28, delay: '0s', size: 14 },
    { x: 78, y: 44, delay: '0.4s', size: 10 },
    { x: 32, y: 52, delay: '0.7s', size: 8 },
    { x: 68, y: 18, delay: '0.2s', size: 6 },
    { x: 88, y: 62, delay: '0.9s', size: 7 },
    { x: 22, y: 38, delay: '0.5s', size: 9 },
    { x: 44, y: 14, delay: '1.1s', size: 5 },
  ]

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: 'rgba(5,10,28,0.75)',
        backdropFilter: 'blur(6px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 60,
        padding: '24px',
        animation: 'overlayIn 0.35s ease',
      }}
    >
      <div
        style={{
          width: '100%',
          background: 'linear-gradient(145deg, rgba(26,40,95,0.95) 0%, rgba(18,28,72,0.98) 100%)',
          backdropFilter: 'blur(24px)',
          borderRadius: '28px',
          border: '1px solid rgba(245,200,66,0.22)',
          boxShadow: '0 24px 64px rgba(0,0,0,0.6), inset 0 1px 0 rgba(245,200,66,0.08)',
          padding: '32px 28px',
          animation: 'modalIn 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Background glow */}
        <div
          style={{
            position: 'absolute',
            top: '-40px',
            left: '50%',
            transform: 'translateX(-50%)',
            width: '200px',
            height: '200px',
            background: 'radial-gradient(circle, rgba(245,200,66,0.08) 0%, transparent 70%)',
            pointerEvents: 'none',
          }}
        />

        {/* Stars */}
        {stars.map((s, i) => (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: `${s.x}%`,
              top: `${s.y}%`,
              animation: `twinkle ${1.5 + i * 0.3}s ${s.delay} ease-in-out infinite`,
              pointerEvents: 'none',
            }}
          >
            <svg viewBox="0 0 12 12" width={s.size} height={s.size} fill={night.accent}>
              <path d="M6 0 L6.8 4.8 L12 6 L6.8 7.2 L6 12 L5.2 7.2 L0 6 L5.2 4.8 Z" />
            </svg>
          </div>
        ))}

        {/* Moon illustration */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '24px' }}>
          <div style={{ position: 'relative' }}>
            <div
              style={{
                position: 'absolute',
                inset: '-16px',
                borderRadius: '50%',
                background: 'radial-gradient(circle, rgba(245,200,66,0.18) 0%, transparent 70%)',
                animation: 'glowPulse 2.5s ease-in-out infinite',
              }}
            />
            <svg
              viewBox="0 0 60 60"
              width={72}
              height={72}
              style={{ animation: 'floatMoon 4s ease-in-out infinite', position: 'relative' }}
            >
              <defs>
                <radialGradient id="moonGrad" cx="40%" cy="35%">
                  <stop offset="0%" stopColor="#fff9e0" />
                  <stop offset="100%" stopColor="#f5c842" />
                </radialGradient>
              </defs>
              <path
                d="M38 10 A22 22 0 1 1 14 42 A16 16 0 0 0 38 10Z"
                fill="url(#moonGrad)"
              />
              <circle cx="28" cy="24" r="2.5" fill="rgba(180,140,0,0.25)" />
              <circle cx="36" cy="34" r="1.8" fill="rgba(180,140,0,0.2)" />
              <circle cx="22" cy="36" r="1.5" fill="rgba(180,140,0,0.18)" />
            </svg>
          </div>
        </div>

        {/* Title */}
        <h2
          style={{
            fontFamily: "'Outfit', sans-serif",
            fontWeight: 800,
            fontSize: '22px',
            color: night.text,
            textAlign: 'center',
            letterSpacing: '-0.02em',
            marginBottom: '12px',
          }}
        >
          🌙 Tomorrow's Mission is Ready
        </h2>

        {/* Description */}
        <p
          style={{
            fontFamily: "'DM Sans', sans-serif",
            fontSize: '14px',
            color: night.textDim,
            textAlign: 'center',
            lineHeight: 1.65,
            marginBottom: '8px',
          }}
        >
          Your thoughts have been transformed into a realistic mission for tomorrow.
        </p>
        <p
          style={{
            fontFamily: "'DM Sans', sans-serif",
            fontSize: '14px',
            color: night.accent,
            textAlign: 'center',
            marginBottom: '28px',
            fontWeight: 500,
          }}
        >
          Sleep well. We'll remind you in the morning.
        </p>

        {/* Divider */}
        <div
          style={{
            height: '1px',
            background: 'linear-gradient(90deg, transparent, rgba(245,200,66,0.2), transparent)',
            marginBottom: '24px',
          }}
        />

        {/* Buttons */}
        <button
          onClick={onClose}
          style={{
            width: '100%',
            padding: '15px',
            borderRadius: '16px',
            border: 'none',
            background: `linear-gradient(135deg, ${night.accent} 0%, #e5b030 100%)`,
            color: '#0d1b3e',
            fontFamily: "'Outfit', sans-serif",
            fontWeight: 700,
            fontSize: '16px',
            cursor: 'pointer',
            marginBottom: '10px',
            boxShadow: '0 4px 20px rgba(245,200,66,0.3)',
            transition: 'transform 0.15s, box-shadow 0.15s',
          }}
          onMouseDown={(e) => (e.currentTarget.style.transform = 'scale(0.97)')}
          onMouseUp={(e) => (e.currentTarget.style.transform = 'scale(1)')}
        >
          Good Night ✨
        </button>
        <button
          onClick={onEditThoughts}
          style={{
            width: '100%',
            padding: '13px',
            borderRadius: '16px',
            border: `1px solid ${night.border}`,
            background: 'transparent',
            color: night.textDim,
            fontFamily: "'Outfit', sans-serif",
            fontWeight: 600,
            fontSize: '14px',
            cursor: 'pointer',
            transition: 'color 0.2s, border-color 0.2s',
          }}
        >
          Edit Thoughts
        </button>
      </div>
    </div>
  )
}

// ─── Mission Complete Modal ───────────────────────────────────────────────────

function MissionCompleteModal({
  onViewProgress,
  onHome,
  stats,
  day = lightDayTheme,
}: {
  onViewProgress: () => void
  onHome: () => void
  stats?: ProgressStats
  day?: DayTheme
}) {
  const currentStats = stats || getStats()

  let totalTasks = 0
  let completedTasks = 0
  try {
    const stored = localStorage.getItem('morningTasks')
    if (stored) {
      const parsed = JSON.parse(stored)
      if (Array.isArray(parsed) && parsed.length > 0) {
        totalTasks = parsed.length
        completedTasks = parsed.filter((t: Task) => t.done).length
      }
    }
  } catch (e) {
    console.error('Failed to parse morning tasks in MissionCompleteModal', e)
  }

  if (totalTasks === 0) {
    totalTasks = 1
    completedTasks = 1
  }

  const completionRate = Math.round((completedTasks / totalTasks) * 100)
  const streak = currentStats.streak || 0
  const isDark = day.bg === darkDayTheme.bg

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: isDark ? 'rgba(15,23,42,0.88)' : 'rgba(247,244,238,0.88)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 60,
        padding: '24px',
        animation: 'overlayIn 0.35s ease',
      }}
    >
      <Confetti />

      <div
        style={{
          width: '100%',
          background: day.surface,
          borderRadius: '28px',
          border: `1px solid ${day.border}`,
          boxShadow: isDark ? '0 20px 60px rgba(0,0,0,0.5)' : '0 20px 60px rgba(0,0,0,0.1)',
          padding: '32px 28px',
          animation: 'modalIn 0.45s cubic-bezier(0.34, 1.56, 0.64, 1)',
          position: 'relative',
          zIndex: 1,
        }}
      >
        {/* Trophy */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '20px' }}>
          <div
            style={{
              width: '80px',
              height: '80px',
              borderRadius: '50%',
              background: isDark
                ? 'linear-gradient(135deg, rgba(245,200,66,0.25) 0%, rgba(245,200,66,0.1) 100%)'
                : 'linear-gradient(135deg, #fff8dc 0%, #fef3c7 100%)',
              border: isDark ? '1px solid rgba(245,200,66,0.4)' : 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 4px 24px rgba(245,200,66,0.35)',
              animation: 'trophyBounce 2s ease-in-out infinite',
              fontSize: '36px',
            }}
          >
            🏆
          </div>
        </div>

        <h2
          style={{
            fontFamily: "'Outfit', sans-serif",
            fontWeight: 800,
            fontSize: '24px',
            color: day.text,
            textAlign: 'center',
            letterSpacing: '-0.02em',
            marginBottom: '8px',
          }}
        >
          🎉 Mission Complete!
        </h2>
        <p
          style={{
            fontFamily: "'DM Sans', sans-serif",
            fontSize: '14px',
            color: day.textDim,
            textAlign: 'center',
            lineHeight: 1.6,
            marginBottom: '24px',
          }}
        >
          Great job! You completed today's mission
          <br />and stayed consistent.
        </p>

        {/* Stats card */}
        <div
          style={{
            background: day.surfaceAlt,
            borderRadius: '18px',
            padding: '18px',
            marginBottom: '24px',
            border: `1px solid ${day.border}`,
          }}
        >
          {[
            { icon: '✅', label: 'Tasks Completed', value: `${completedTasks} / ${totalTasks}` },
            { icon: '🔥', label: 'Current Streak', value: `${streak} day${streak === 1 ? '' : 's'}` },
            { icon: '📈', label: 'Completion Rate', value: `${completionRate}%` },
          ].map((stat, idx, arr) => (
            <div
              key={stat.label}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '8px 0',
                borderBottom: idx < arr.length - 1 ? `1px solid ${day.border}` : 'none',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '16px' }}>{stat.icon}</span>
                <span
                  style={{
                    fontFamily: "'DM Sans', sans-serif",
                    fontSize: '14px',
                    color: day.textDim,
                  }}
                >
                  {stat.label}
                </span>
              </div>
              <span
                style={{
                  fontFamily: "'Outfit', sans-serif",
                  fontWeight: 700,
                  fontSize: '15px',
                  color: day.text,
                }}
              >
                {stat.value}
              </span>
            </div>
          ))}
        </div>

        <button
          onClick={onViewProgress}
          style={{
            width: '100%',
            padding: '15px',
            borderRadius: '16px',
            border: 'none',
            background: `linear-gradient(135deg, ${day.accent} 0%, #d4802a 100%)`,
            color: isDark ? '#0f172a' : '#fff',
            fontFamily: "'Outfit', sans-serif",
            fontWeight: 700,
            fontSize: '16px',
            cursor: 'pointer',
            marginBottom: '10px',
            boxShadow: '0 4px 20px rgba(232,144,58,0.3)',
            transition: 'transform 0.15s',
          }}
          onMouseDown={(e) => (e.currentTarget.style.transform = 'scale(0.97)')}
          onMouseUp={(e) => (e.currentTarget.style.transform = 'scale(1)')}
        >
          View Progress
        </button>
        <button
          onClick={onHome}
          style={{
            width: '100%',
            padding: '13px',
            borderRadius: '16px',
            border: `1px solid ${day.border}`,
            background: 'transparent',
            color: day.text,
            fontFamily: "'Outfit', sans-serif",
            fontWeight: 600,
            fontSize: '14px',
            cursor: 'pointer',
          }}
        >
          Back to Home
        </button>
      </div>
    </div>
  )
}

// ─── Smart Trim Modal ─────────────────────────────────────────────────────────

function SmartTrimModal({
  originalTasks,
  onApply,
  onCancel,
  day = lightDayTheme,
}: {
  originalTasks: TaskItem[]
  onApply: (trimmed: TaskItem[]) => void
  onCancel: () => void
  day?: DayTheme
}) {
  const [isTrimming, setIsTrimming] = useState(true)
  const [previewTasks, setPreviewTasks] = useState<TaskItem[]>([])

  useEffect(() => {
    let active = true
    async function runTrim() {
      setIsTrimming(true)
      try {
        const trimmed = await groqSmartTrim(originalTasks)
        if (active) {
          setPreviewTasks(sortTasksByPriority(trimmed))
        }
      } catch (err) {
        console.warn('Smart Trim error:', err)
        if (active) {
          setPreviewTasks(originalTasks)
        }
      } finally {
        if (active) setIsTrimming(false)
      }
    }
    runTrim()
    return () => {
      active = false
    }
  }, [originalTasks])

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: day.bg === darkDayTheme.bg ? 'rgba(15,23,42,0.88)' : 'rgba(247,244,238,0.88)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        zIndex: 60,
        padding: '0 0 16px',
        animation: 'overlayIn 0.3s ease',
      }}
    >
      <div
        style={{
          width: '100%',
          maxHeight: '88vh',
          display: 'flex',
          flexDirection: 'column',
          background: day.surface,
          borderRadius: '28px 28px 24px 24px',
          border: `1px solid ${day.border}`,
          boxShadow: '0 -8px 40px rgba(0,0,0,0.1)',
          padding: '24px 20px 20px',
          animation: 'modalIn 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)',
        }}
      >
        {/* Handle */}
        <div
          style={{
            width: '36px',
            height: '4px',
            borderRadius: '99px',
            background: day.border,
            margin: '0 auto 16px',
          }}
        />

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '14px' }}>
          <div
            style={{
              width: '42px',
              height: '42px',
              borderRadius: '13px',
              background: 'linear-gradient(135deg, rgba(232,144,58,0.15) 0%, rgba(245,200,66,0.12) 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '20px',
            }}
          >
            ✨
          </div>
          <div>
            <h3
              style={{
                fontFamily: "'Outfit', sans-serif",
                fontWeight: 800,
                fontSize: '18px',
                color: day.text,
                letterSpacing: '-0.02em',
              }}
            >
              Smart Trim Suggested Mission
            </h3>
            <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: '12px', color: day.textDim }}>
              {isTrimming
                ? 'AI is analyzing workload & protecting high priority tasks...'
                : `Optimized from ${originalTasks.length} to ${previewTasks.length} task${previewTasks.length === 1 ? '' : 's'}`}
            </p>
          </div>
        </div>

        {isTrimming ? (
          <div style={{ padding: '36px 16px', textAlign: 'center' }}>
            <div
              style={{
                width: '32px',
                height: '32px',
                border: `3px solid ${day.accent}`,
                borderTopColor: 'transparent',
                borderRadius: '50%',
                margin: '0 auto 16px',
                animation: 'spin 0.8s linear infinite',
              }}
            />
            <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: '14px', color: day.text, fontWeight: 500 }}>
              Analyzing workload and trimming optional tasks...
            </p>
          </div>
        ) : (
          <>
            <div
              style={{
                background: 'linear-gradient(135deg, rgba(232,144,58,0.08) 0%, rgba(245,200,66,0.05) 100%)',
                border: `1px solid rgba(232,144,58,0.2)`,
                borderRadius: '14px',
                padding: '12px 14px',
                marginBottom: '14px',
              }}
            >
              <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: '12px', color: day.text, lineHeight: 1.5, fontWeight: 500, margin: 0 }}>
                🛡️ High-priority tasks are preserved. Optional & lower-priority tasks have been shortened or consolidated.
              </p>
            </div>

            {/* Task Preview Scroll Area */}
            <div style={{ overflowY: 'auto', maxHeight: '220px', display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '18px' }}>
              {previewTasks.map((t) => {
                const priorityColor =
                  t.priority === 'high' ? day.red : t.priority === 'medium' ? day.accent : day.textDim
                const priorityBg =
                  t.priority === 'high'
                    ? 'rgba(212,74,58,0.1)'
                    : t.priority === 'medium'
                    ? 'rgba(232,144,58,0.1)'
                    : 'rgba(100,116,139,0.1)'

                return (
                  <div
                    key={t.id}
                    style={{
                      padding: '10px 12px',
                      borderRadius: '12px',
                      background: day.surfaceAlt,
                      border: `1px solid ${day.border}`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '10px',
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: '13px', color: day.text, fontWeight: 600, margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {t.text}
                      </p>
                      {t.description && (
                        <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: '11px', color: day.textDim, margin: '2px 0 0' }}>
                          {t.description}
                        </p>
                      )}
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                      <span
                        style={{
                          fontSize: '10px',
                          fontWeight: 700,
                          textTransform: 'uppercase',
                          color: priorityColor,
                          background: priorityBg,
                          padding: '2px 6px',
                          borderRadius: '6px',
                          fontFamily: "'Outfit', sans-serif",
                        }}
                      >
                        {t.priority}
                      </span>
                      <span
                        style={{
                          fontSize: '11px',
                          fontWeight: 600,
                          color: day.textDim,
                          background: day.border,
                          padding: '2px 6px',
                          borderRadius: '6px',
                          fontFamily: "'DM Sans', sans-serif",
                        }}
                      >
                        {t.duration}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>

            <button
              onClick={() => onApply(previewTasks)}
              style={{
                width: '100%',
                padding: '14px',
                borderRadius: '16px',
                border: 'none',
                background: `linear-gradient(135deg, ${day.accent} 0%, #d4802a 100%)`,
                color: '#fff',
                fontFamily: "'Outfit', sans-serif",
                fontWeight: 700,
                fontSize: '15px',
                cursor: 'pointer',
                marginBottom: '10px',
                boxShadow: '0 4px 20px rgba(232,144,58,0.28)',
              }}
            >
              Apply Changes
            </button>
            <button
              onClick={onCancel}
              style={{
                width: '100%',
                padding: '12px',
                borderRadius: '16px',
                border: `1px solid ${day.border}`,
                background: 'transparent',
                color: day.textDim,
                fontFamily: "'Outfit', sans-serif",
                fontWeight: 600,
                fontSize: '14px',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          </>
        )}
      </div>
    </div>
  )
}

// ─── Bottom Nav ───────────────────────────────────────────────────────────────

function BottomNav({
  active,
  onChange,
  isDark,
  day = lightDayTheme,
}: {
  active: Screen
  onChange: (s: Screen) => void
  isDark: boolean
  day?: DayTheme
}) {
  const [pressedTab, setPressedTab] = useState<Screen | null>(null)

  const tabs: { id: Screen; label: string; icon: React.ReactNode }[] = [
    {
      id: 'night',
      label: 'Night',
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
          <path d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79z" />
        </svg>
      ),
    },
    {
      id: 'morning',
      label: 'Morning',
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
          <circle cx="12" cy="12" r="5" />
          <line x1="12" y1="1" x2="12" y2="3" />
          <line x1="12" y1="21" x2="12" y2="23" />
          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
          <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
          <line x1="1" y1="12" x2="3" y2="12" />
          <line x1="21" y1="12" x2="23" y2="12" />
          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
          <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
        </svg>
      ),
    },
    {
      id: 'progress',
      label: 'Progress',
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
        </svg>
      ),
    },
    {
      id: 'settings',
      label: 'Settings',
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      ),
    },
  ]

  const bg = active === 'night' ? night.surface : day.surface
  const border = active === 'night' ? night.border : day.border
  const activeColor = active === 'night' ? night.accent : day.accent
  const inactiveColor = active === 'night' ? night.textDim : day.textDim

  return (
    <div
      style={{
        background: bg,
        borderTop: `1px solid ${border}`,
        backdropFilter: 'blur(12px)',
        paddingBottom: 'calc(1.25rem + env(safe-area-inset-bottom, 0px))',
      }}
      className="flex items-center justify-around px-2 pt-3"
    >
      {tabs.map((tab) => {
        const isActive = active === tab.id
        const isPressed = pressedTab === tab.id
        return (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            onMouseDown={() => setPressedTab(tab.id)}
            onMouseUp={() => setPressedTab(null)}
            onMouseLeave={() => setPressedTab(null)}
            className="flex flex-col items-center gap-1 px-4"
            style={{
              color: isActive ? activeColor : inactiveColor,
              transition: 'color 0.2s',
            }}
          >
            <span
              style={{
                transform: isPressed ? 'scale(0.88)' : isActive ? 'scale(1.1)' : 'scale(1)',
                transition: 'transform 0.18s cubic-bezier(0.34, 1.56, 0.64, 1)',
                display: 'block',
              }}
            >
              {tab.icon}
            </span>
            <span
              style={{
                fontFamily: "'DM Sans', sans-serif",
                fontSize: '10px',
                fontWeight: isActive ? 600 : 400,
                letterSpacing: '0.03em',
                transition: 'font-weight 0.2s',
              }}
            >
              {tab.label}
            </span>
          </button>
        )
      })}
    </div>
  )
}

// ─── Night Capture Screen ─────────────────────────────────────────────────────

function NightCapture({
  onGenerateMission,
  isLocked,
  showDialog,
  onContinueEditing,
  onDone,
  onGoToMorning,
}: {
  onGenerateMission: (thought: string) => void
  isLocked: boolean
  showDialog: boolean
  onContinueEditing: () => void
  onDone: () => void
  onGoToMorning: () => void
}) {
  if (isLocked) {
    return (
      <div className="flex flex-col flex-1 px-6 py-8 items-center justify-center text-center" style={{ background: 'linear-gradient(160deg, #0d1b3e 0%, #0b1530 60%, #07102a 100%)' }}>
        <svg viewBox="0 0 24 24" width={48} height={48} stroke={night.accent} fill="none" strokeWidth={1.5} className="mb-6"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
        <h2 style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 700, fontSize: '20px', color: night.text, marginBottom: '12px', lineHeight: 1.4 }}>Night planning is available after today's mission.</h2>
        <button onClick={onGoToMorning} style={{ background: night.accent, color: '#0d1b3e', padding: '12px 24px', borderRadius: '12px', fontFamily: "'Outfit', sans-serif", fontWeight: 600, fontSize: '15px', border: 'none', cursor: 'pointer', marginTop: '24px' }}>Go to Morning Mission</button>
      </div>
    )
  }

  if (showDialog) {
    return (
      <div className="flex flex-col flex-1 px-6 py-8 items-center justify-center text-center" style={{ background: 'linear-gradient(160deg, #0d1b3e 0%, #0b1530 60%, #07102a 100%)' }}>
        <h2 style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 700, fontSize: '24px', color: night.text, marginBottom: '32px' }}>Already remembered something?</h2>
        <div className="flex flex-col gap-3 w-full max-w-[260px]">
          <button onClick={onContinueEditing} style={{ background: night.accent, color: '#0d1b3e', padding: '14px', borderRadius: '12px', fontFamily: "'Outfit', sans-serif", fontWeight: 600, fontSize: '15px', border: 'none', cursor: 'pointer' }}>Continue Editing</button>
          <button onClick={onDone} style={{ background: 'transparent', color: night.text, padding: '14px', borderRadius: '12px', fontFamily: "'Outfit', sans-serif", fontWeight: 600, fontSize: '15px', border: `1px solid ${night.border}`, cursor: 'pointer' }}>I'm Done</button>
        </div>
      </div>
    )
  }

  const [isRecording, setIsRecording] = useState(false)
  const [voiceError, setVoiceError] = useState<string | null>(null)
  const [interimTranscript, setInterimTranscript] = useState('')
  const [thought, setThought] = useState(() => localStorage.getItem('nightEntryThought') || '')
  const voiceSessionRef = useRef<VoiceSession | null>(null)

  if (!voiceSessionRef.current) {
    voiceSessionRef.current = new VoiceSession()
  }

  useEffect(() => {
    localStorage.setItem('nightEntryThought', thought)
  }, [thought])

  const toggleRecording = () => {
    if (isRecording) {
      voiceSessionRef.current?.stopListening()
      setIsRecording(false)
      setInterimTranscript('')
    } else {
      setVoiceError(null)
      voiceSessionRef.current?.startListening({
        onStart: () => {
          setIsRecording(true)
          setVoiceError(null)
        },
        onResult: (transcript, isFinal) => {
          if (isFinal) {
            setThought((prev) => {
              const space = prev.length > 0 && !prev.endsWith(' ') ? ' ' : ''
              return prev + space + transcript.trim()
            })
            setInterimTranscript('')
          } else {
            setInterimTranscript(transcript)
          }
        },
        onError: (errMsg) => {
          setVoiceError(errMsg)
          setIsRecording(false)
          setInterimTranscript('')
        },
        onEnd: () => {
          setIsRecording(false)
          setInterimTranscript('')
        },
      })
    }
  }

  return (
    <div
      className="flex flex-col flex-1 px-6 py-8 overflow-y-auto"
      style={{ background: 'linear-gradient(160deg, #0d1b3e 0%, #0b1530 60%, #07102a 100%)' }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 mb-8">
        <svg viewBox="0 0 24 24" fill={night.accent} className="w-6 h-6"
          style={{ animation: 'floatMoon 6s ease-in-out infinite' }}>
          <path d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79z" />
        </svg>
        <span style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 700, fontSize: '22px', color: night.text, letterSpacing: '-0.02em' }}>
          NightNote
        </span>
      </div>

      {/* Headline */}
      <div className="mb-10">
        <h1 style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 800, fontSize: '32px', lineHeight: 1.15, color: night.text, letterSpacing: '-0.03em' }}>
          Dump your<br />
          <span style={{ color: night.accent }}>thoughts.</span>
        </h1>
        <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: '14px', color: night.textDim, marginTop: '8px' }}>
          No pressure. Just let it out before sleep.
        </p>
      </div>

      {/* Mic Button */}
      <div className="flex flex-col items-center mb-8">
        <button
          onClick={toggleRecording}
          className="relative flex items-center justify-center rounded-full"
          style={{
            width: '140px',
            height: '140px',
            background: isRecording
              ? 'radial-gradient(circle, #f5c842 0%, #d4a010 100%)'
              : 'radial-gradient(circle, #1e2d6e 0%, #162050 100%)',
            boxShadow: isRecording
              ? '0 0 40px rgba(245,200,66,0.6), 0 0 80px rgba(245,200,66,0.2)'
              : undefined,
            border: `2px solid ${isRecording ? 'rgba(255,255,255,0.3)' : night.border}`,
            transform: isRecording ? 'scale(1.04)' : 'scale(1)',
            animation: isRecording ? undefined : 'softPulse 3s ease-in-out infinite',
            transition: 'transform 0.3s, border-color 0.3s, background 0.3s',
          }}
        >
          {isRecording && (
            <>
              <span className="absolute rounded-full animate-ping"
                style={{ width: '160px', height: '160px', background: 'rgba(245,200,66,0.15)', animationDuration: '1.2s' }} />
              <span className="absolute rounded-full animate-ping"
                style={{ width: '180px', height: '180px', background: 'rgba(245,200,66,0.08)', animationDuration: '1.6s', animationDelay: '0.3s' }} />
            </>
          )}
          <svg viewBox="0 0 24 24" fill="none"
            stroke={isRecording ? '#0d1b3e' : night.accent}
            strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-12 h-12">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="23" />
            <line x1="8" y1="23" x2="16" y2="23" />
          </svg>
        </button>
        <p style={{
          fontFamily: "'DM Sans', sans-serif", fontSize: '13px',
          color: isRecording ? night.accent : night.textDim,
          marginTop: '14px', fontWeight: isRecording ? 600 : 400, transition: 'color 0.3s',
          textAlign: 'center',
        }}>
          {isRecording ? 'Listening… tap mic to finish' : 'Tap to speak'}
        </p>

        {/* Live Interim Transcript Badge */}
        {isRecording && interimTranscript && (
          <div style={{
            marginTop: '8px',
            padding: '6px 12px',
            borderRadius: '12px',
            background: 'rgba(245,200,66,0.15)',
            border: `1px solid rgba(245,200,66,0.3)`,
            color: night.accent,
            fontFamily: "'DM Sans', sans-serif",
            fontSize: '12px',
            fontStyle: 'italic',
            maxWidth: '280px',
            textAlign: 'center',
          }}>
            "{interimTranscript}…"
          </div>
        )}

        {/* Voice Error Banner */}
        {voiceError && (
          <div style={{
            marginTop: '10px',
            padding: '8px 12px',
            borderRadius: '10px',
            background: 'rgba(212,74,58,0.18)',
            border: '1px solid rgba(212,74,58,0.35)',
            color: '#f87171',
            fontFamily: "'DM Sans', sans-serif",
            fontSize: '12px',
            maxWidth: '280px',
            textAlign: 'center',
          }}>
            ⚠️ {voiceError}
          </div>
        )}
      </div>

      {/* Divider */}
      <div className="flex items-center gap-3 mb-6">
        <div style={{ flex: 1, height: '1px', background: night.border }} />
        <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: '12px', color: night.textDim }}>or type</span>
        <div style={{ flex: 1, height: '1px', background: night.border }} />
      </div>

      {/* Text Input */}
      <div className="relative mb-4">
        <textarea
          value={thought}
          onChange={(e) => setThought(e.target.value)}
          placeholder="Enter your thoughts or speak above..."
          rows={4}
          style={{
            width: '100%', background: night.surface,
            border: `1.5px solid ${thought ? night.accent : night.border}`,
            borderRadius: '16px', padding: '16px', color: night.text,
            fontFamily: "'DM Sans', sans-serif", fontSize: '15px', lineHeight: 1.6,
            resize: 'none', outline: 'none', transition: 'border-color 0.2s',
          }}
        />
      </div>

      {/* Generate Mission Button */}
      <button
        onClick={() => onGenerateMission(thought)}
        disabled={!thought.trim()}
        style={{
          background: thought.trim() ? night.accent : 'rgba(245,200,66,0.08)',
          border: thought.trim() ? `1.5px solid ${night.accent}` : `1.5px solid ${night.border}`,
          borderRadius: '14px', padding: '14px',
          color: thought.trim() ? '#0d1b3e' : night.accent,
          fontFamily: "'Outfit', sans-serif", fontWeight: 700, fontSize: '15px',
          cursor: thought.trim() ? 'pointer' : 'not-allowed',
          transition: 'all 0.2s',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
          opacity: thought.trim() ? 1 : 0.5,
        }}
      >
        <svg viewBox="0 0 20 20" width={18} height={18} fill={thought.trim() ? '#0d1b3e' : night.accent}>
          <path d="M10 0 L12.5 7.5 L20 10 L12.5 12.5 L10 20 L7.5 12.5 L0 10 L7.5 7.5 Z" />
        </svg>
        Generate Tomorrow's Mission
      </button>

      {/* Stars */}
      <div className="flex justify-center mt-8 gap-6 opacity-20">
        {['✦', '✧', '✦', '✧', '✦'].map((s, i) => (
          <span key={i} style={{ color: night.accent, fontSize: i % 2 === 0 ? '10px' : '7px',
            animation: `twinkle ${2 + i * 0.4}s ${i * 0.3}s ease-in-out infinite` }}>
            {s}
          </span>
        ))}
      </div>
    </div>
  )
}

// ─── Task Card ────────────────────────────────────────────────────────────────

function TaskCard({
  task,
  onToggle,
  day = lightDayTheme,
}: {
  task: Task
  onToggle: () => void
  day?: DayTheme
}) {
  const [pressed, setPressed] = useState(false)
  const s = priorityStyle(task.priority, day)
  
  const [localDone, setLocalDone] = useState(task.done)
  const [isCollapsing, setIsCollapsing] = useState(false)
  const [isCompleting, setIsCompleting] = useState(false)

  const handleToggle = () => {
    if (!localDone) {
      setLocalDone(true)
      setIsCompleting(true)
      setTimeout(() => {
        setIsCollapsing(true)
        setTimeout(() => {
          onToggle()
        }, 300) // collapse duration
      }, 500) // delay before collapse
    } else {
      setLocalDone(false)
      setIsCompleting(false)
      onToggle()
    }
  }

  if (task.done && !localDone && !isCollapsing) {
    setLocalDone(true)
  }

  if (isCollapsing && task.done) {
    return null; // hide immediately if parent re-renders and it's already done
  }

  return (
    <div
      onClick={handleToggle}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      onMouseLeave={() => setPressed(false)}
      style={{
        '--initial-bg': s.bg,
        background: localDone ? 'rgba(0,0,0,0.03)' : s.bg,
        border: `1.5px solid ${localDone ? day.border : s.border}`,
        borderRadius: '16px',
        padding: isCollapsing ? '0 16px' : '14px 16px',
        marginBottom: isCollapsing ? '0' : '0',
        maxHeight: isCollapsing ? '0' : '80px',
        opacity: localDone ? 0.6 : 1,
        transform: pressed ? 'scale(0.98)' : 'scale(1)',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        overflow: 'hidden',
        transition: 'padding 0.3s, max-height 0.3s, opacity 0.3s, transform 0.15s',
        animation: isCompleting ? 'taskCompleteFlash 0.5s ease forwards' : undefined,
      } as React.CSSProperties}
    >
      {/* Checkbox */}
      <div
        style={{
          width: '22px',
          height: '22px',
          borderRadius: '7px',
          border: `2px solid ${localDone ? day.textDim : s.dot}`,
          background: localDone ? s.dot : 'transparent',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          transition: 'background 0.2s, border-color 0.2s',
        }}
      >
        {localDone && (
          <svg viewBox="0 0 12 12" width={14} height={14} fill="none"
            stroke="#fff" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
            <polyline
              points="2,6 5,9 10,3"
              style={{
                strokeDasharray: 20,
                strokeDashoffset: 0,
                animation: 'checkDraw 0.3s ease forwards',
              }}
            />
          </svg>
        )}
      </div>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
        <p style={{
          fontFamily: "'DM Sans', sans-serif", fontWeight: 500, fontSize: '15px',
          color: day.text,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          position: 'relative',
          display: 'inline-block',
          maxWidth: '100%'
        }}>
          {task.text}
          {localDone && (
            <span style={{
              position: 'absolute',
              top: '50%',
              left: 0,
              width: '100%',
              height: '1.5px',
              background: day.textDim,
              transformOrigin: 'left',
              animation: 'strikeDraw 0.3s ease-out forwards',
            }} />
          )}
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
          <span style={{ fontSize: '11px', color: day.textDim, fontFamily: "'DM Sans', sans-serif" }}>
            ⏱ {task.duration}
          </span>
        </div>
      </div>

      {/* Priority chip */}
      <span
        style={{
          padding: '3px 10px',
          borderRadius: '99px',
          background: s.bg,
          border: `1px solid ${s.border}`,
          color: s.dot,
          fontFamily: "'DM Sans', sans-serif",
          fontSize: '11px',
          fontWeight: 700,
          flexShrink: 0,
          opacity: localDone ? 0.4 : 1,
          transition: 'opacity 0.3s',
        }}
      >
        {s.label}
      </span>
    </div>
  )
}

// ─── Morning Mission Screen ───────────────────────────────────────────────────

function MorningMission({
  onAllComplete,
  onNavigate,
  onUpdateStats,
  day = lightDayTheme,
}: {
  onAllComplete: (taskCount: number) => void
  onNavigate?: (s: Screen) => void
  onUpdateStats?: (s: ProgressStats) => void
  day?: DayTheme
}) {
  const [tasks, setTasks] = useState<Task[]>(() => {
    try {
      const stored = localStorage.getItem('morningTasks');
      if (stored) {
        const parsed = JSON.parse(stored)
        if (Array.isArray(parsed)) return sortTasksByPriority(parsed)
      }
    } catch (e) {
      console.error('Failed to parse tasks', e);
    }
    return [];
  })

  useEffect(() => {
    localStorage.setItem('morningTasks', JSON.stringify(tasks));
    if (onUpdateStats) {
      const updatedStats = recordTaskActivity(tasks)
      onUpdateStats(updatedStats)
    }
  }, [tasks, onUpdateStats]);
  const [showAdd, setShowAdd] = useState(false)
  const [newText, setNewText] = useState('')
  const [newPriority, setNewPriority] = useState<Priority>('medium')
  const [newDuration, setNewDuration] = useState('30m')
  const [showTrimModal, setShowTrimModal] = useState(false)
  const completeFiredRef = useRef(false)

  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })

  useEffect(() => {
    if (tasks.length > 0 && tasks.every((t) => t.done) && !completeFiredRef.current) {
      completeFiredRef.current = true
      setTimeout(() => onAllComplete(tasks.length), 500)
    }
    if (!tasks.every((t) => t.done)) completeFiredRef.current = false
  }, [tasks, onAllComplete])

  const toggle = (id: string) =>
    setTasks((ts) => sortTasksByPriority(ts.map((t) => (t.id === id ? { ...t, done: !t.done } : t))))

  const addTask = () => {
    if (!newText.trim()) return
    const newTask: Task = {
      id: Date.now().toString(),
      text: newText.trim(),
      priority: newPriority,
      duration: newDuration,
      done: false,
    }
    setTasks((ts) => sortTasksByPriority([...ts, newTask]))
    setNewText('')
    setShowAdd(false)
  }

  const handleApplyTrim = (trimmedTasks: TaskItem[]) => {
    setTasks(sortTasksByPriority(trimmedTasks))
    setShowTrimModal(false)
  }

  const isEmpty = tasks.length === 0

  return (
    <div className="flex flex-col flex-1 overflow-y-auto" style={{ background: day.bg, position: 'relative' }}>
      <div className="px-6 py-8">
        {/* Header */}
        <div className="flex items-center gap-2 mb-6">
          <svg viewBox="0 0 24 24" fill={day.accent} className="w-6 h-6">
            <circle cx="12" cy="12" r="5" />
            <line x1="12" y1="1" x2="12" y2="3" stroke={day.accent} strokeWidth={2} strokeLinecap="round" />
            <line x1="12" y1="21" x2="12" y2="23" stroke={day.accent} strokeWidth={2} strokeLinecap="round" />
            <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" stroke={day.accent} strokeWidth={2} strokeLinecap="round" />
            <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" stroke={day.accent} strokeWidth={2} strokeLinecap="round" />
            <line x1="1" y1="12" x2="3" y2="12" stroke={day.accent} strokeWidth={2} strokeLinecap="round" />
            <line x1="21" y1="12" x2="23" y2="12" stroke={day.accent} strokeWidth={2} strokeLinecap="round" />
          </svg>
          <span style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 700, fontSize: '22px', color: day.text, letterSpacing: '-0.02em' }}>
            NightNote
          </span>
        </div>

        <div className="flex items-start justify-between mb-1">
          <div>
            <h2 style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 800, fontSize: '24px', color: day.text, letterSpacing: '-0.03em' }}>
              Morning Mission
            </h2>
            <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: '13px', color: day.textDim, marginTop: '2px' }}>
              {today}
            </p>
          </div>
          <button
            onClick={() => setShowAdd(!showAdd)}
            style={{
              background: day.accent, border: 'none', borderRadius: '10px',
              padding: '8px 14px', color: '#fff',
              fontFamily: "'Outfit', sans-serif", fontWeight: 600, fontSize: '13px',
              cursor: 'pointer', whiteSpace: 'nowrap',
              transition: 'transform 0.15s',
            }}
            onMouseDown={(e) => (e.currentTarget.style.transform = 'scale(0.94)')}
            onMouseUp={(e) => (e.currentTarget.style.transform = 'scale(1)')}
          >
            + Add Task
          </button>
        </div>

        <p style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 600, fontSize: '15px', color: day.textDim, marginBottom: '20px', marginTop: '6px' }}>
          {"Today's Tasks!"}
        </p>

        {/* Add task form */}
        {showAdd && (
          <div className="mb-4 p-4 rounded-2xl" style={{ background: day.surface, border: `1px solid ${day.border}` }}>
            <input
              autoFocus value={newText}
              onChange={(e) => setNewText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addTask()}
              placeholder="What do you need to do?"
              style={{
                width: '100%', background: day.surfaceAlt,
                border: `1px solid ${day.border}`, borderRadius: '10px',
                padding: '10px 14px', fontFamily: "'DM Sans', sans-serif",
                fontSize: '14px', color: day.text, outline: 'none', marginBottom: '10px',
              }}
            />
            <input
              value={newDuration}
              onChange={(e) => setNewDuration(e.target.value)}
              placeholder="Duration (e.g. 30m)"
              style={{
                width: '100%', background: day.surfaceAlt,
                border: `1px solid ${day.border}`, borderRadius: '10px',
                padding: '10px 14px', fontFamily: "'DM Sans', sans-serif",
                fontSize: '14px', color: day.text, outline: 'none', marginBottom: '10px',
              }}
            />
            <div className="flex gap-2 mb-3">
              {(['high', 'medium', 'low'] as Priority[]).map((p) => {
                const s = priorityStyle(p, day)
                return (
                  <button key={p} onClick={() => setNewPriority(p)}
                    style={{
                      flex: 1, padding: '6px', borderRadius: '8px',
                      border: `1.5px solid ${newPriority === p ? s.border : day.border}`,
                      background: newPriority === p ? s.bg : 'transparent',
                      color: newPriority === p ? s.dot : day.textDim,
                      fontFamily: "'DM Sans', sans-serif", fontSize: '12px', fontWeight: 600,
                      cursor: 'pointer', textTransform: 'capitalize',
                    }}>
                    {p}
                  </button>
                )
              })}
            </div>
            <button onClick={addTask}
              style={{
                width: '100%', background: day.accent, border: 'none',
                borderRadius: '10px', padding: '10px', color: '#fff',
                fontFamily: "'Outfit', sans-serif", fontWeight: 600, fontSize: '14px', cursor: 'pointer',
              }}>
              Add
            </button>
          </div>
        )}

        {/* Empty state */}
        {isEmpty ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '32px 0 16px', textAlign: 'center' }}>
            {/* Coffee + sunrise illustration */}
            <svg viewBox="0 0 120 100" width={140} height={116} style={{ marginBottom: '20px' }}>
              {/* Sunrise arcs */}
              <path d="M20 75 Q60 20 100 75" fill="none" stroke="rgba(232,144,58,0.15)" strokeWidth="3" />
              <path d="M30 75 Q60 32 90 75" fill="none" stroke="rgba(232,144,58,0.25)" strokeWidth="2.5" />
              <path d="M40 75 Q60 44 80 75" fill="none" stroke="rgba(232,144,58,0.4)" strokeWidth="2" />
              {/* Sun */}
              <circle cx="60" cy="56" r="14" fill={day.accent} opacity={0.85} />
              {/* Rays */}
              {[0, 45, 90, 135, 180, 225, 270, 315].map((a, i) => (
                <line key={i}
                  x1={60 + Math.cos(a * Math.PI / 180) * 18}
                  y1={56 + Math.sin(a * Math.PI / 180) * 18}
                  x2={60 + Math.cos(a * Math.PI / 180) * 24}
                  y2={56 + Math.sin(a * Math.PI / 180) * 24}
                  stroke={day.accent} strokeWidth="2.5" strokeLinecap="round" opacity={0.7}
                />
              ))}
              {/* Coffee mug */}
              <rect x="46" y="72" width="28" height="22" rx="4" fill="#c8956a" />
              <path d="M74 78 Q82 80 74 86" fill="none" stroke="#c8956a" strokeWidth="3.5" strokeLinecap="round" />
              {/* Steam */}
              <path d="M54 68 Q57 62 54 57" fill="none" stroke="rgba(200,149,106,0.5)" strokeWidth="2" strokeLinecap="round" />
              <path d="M60 66 Q63 60 60 55" fill="none" stroke="rgba(200,149,106,0.5)" strokeWidth="2" strokeLinecap="round" />
              <path d="M66 68 Q69 62 66 57" fill="none" stroke="rgba(200,149,106,0.5)" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <h3 style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 700, fontSize: '18px', color: day.text, marginBottom: '8px' }}>
              No mission for today.
            </h3>
            <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: '14px', color: day.textDim, lineHeight: 1.6 }}>
              Plan one tonight using the<br />Night Capture screen.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {tasks.map((task) => (
              <TaskCard key={task.id} task={task} onToggle={() => toggle(task.id)} day={day} />
            ))}
          </div>
        )}
      </div>

      {/* Feeling overwhelmed CTA */}
      {!isEmpty && (
        <div className="px-6 pb-4 mt-auto">
          <div
            style={{
              background: 'linear-gradient(135deg, rgba(232,144,58,0.13) 0%, rgba(245,200,66,0.09) 100%)',
              border: '1px solid rgba(232,144,58,0.22)',
              borderRadius: '20px',
              padding: '18px 20px',
              boxShadow: '0 4px 20px rgba(232,144,58,0.08)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' }}>
              <div style={{ flex: 1 }}>
                <p style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 700, fontSize: '15px', color: day.text, marginBottom: '4px' }}>
                  Feeling overwhelmed?
                </p>
                <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: '12px', color: day.textDim, lineHeight: 1.5 }}>
                  Let AI simplify today's mission while protecting your important tasks.
                </p>
              </div>
              <button
                onClick={() => setShowTrimModal(true)}
                style={{
                  background: `linear-gradient(135deg, ${day.accent} 0%, #d4802a 100%)`,
                  border: 'none', borderRadius: '20px',
                  padding: '9px 18px', color: '#fff',
                  fontFamily: "'Outfit', sans-serif", fontWeight: 700, fontSize: '13px',
                  cursor: 'pointer', whiteSpace: 'nowrap',
                  boxShadow: '0 3px 12px rgba(232,144,58,0.28)',
                  transition: 'transform 0.15s',
                }}
                onMouseDown={(e) => (e.currentTarget.style.transform = 'scale(0.95)')}
                onMouseUp={(e) => (e.currentTarget.style.transform = 'scale(1)')}
              >
                Smart Trim
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Smart Trim Modal */}
      {showTrimModal && (
        <SmartTrimModal
          originalTasks={tasks}
          onApply={handleApplyTrim}
          onCancel={() => setShowTrimModal(false)}
          day={day}
        />
      )}
    </div>
  )
}

// ─── Progress Screen ──────────────────────────────────────────────────────────

const chartData = [
  { day: 'Mon', consistency: 42, focus: 55 },
  { day: 'Tue', consistency: 58, focus: 70 },
  { day: 'Wed', consistency: 45, focus: 52 },
  { day: 'Thu', consistency: 72, focus: 80 },
  { day: 'Fri', consistency: 65, focus: 74 },
  { day: 'Sat', consistency: 80, focus: 88 },
  { day: 'Sun', consistency: 76, focus: 82 },
]

function AnimatedProgressBar({
  icon, label, value, color, day = lightDayTheme,
}: {
  icon: React.ReactNode; label: string; value: number; color: string; day?: DayTheme
}) {
  const [width, setWidth] = useState(0)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const timer = setTimeout(() => setWidth(value), 200)
    return () => clearTimeout(timer)
  }, [value])

  return (
    <div className="mb-5">
      <div className="flex items-center gap-2 mb-2">
        <span>{icon}</span>
        <span style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 500, fontSize: '15px', color: day.text }}>{label}</span>
        <span style={{ marginLeft: 'auto', fontFamily: "'Outfit', sans-serif", fontWeight: 700, fontSize: '14px', color }}>{value}%</span>
      </div>
      <div style={{ height: '10px', borderRadius: '99px', background: day.surfaceAlt, overflow: 'hidden' }}>
        <div
          ref={ref}
          style={{
            height: '100%',
            width: `${width}%`,
            background: `linear-gradient(90deg, ${color} 0%, ${color}bb 100%)`,
            borderRadius: '99px',
            transition: 'width 1.2s cubic-bezier(0.4, 0, 0.2, 1)',
          }}
        />
      </div>
    </div>
  )
}

function ProgressScreen({ hasData = true, stats, day = lightDayTheme }: { hasData?: boolean; stats: ProgressStats; day?: DayTheme }) {
  const [summaryText, setSummaryText] = useState(stats.weeklyInsight || DEFAULT_STATS.weeklyInsight)
  const [loadingSummary, setLoadingSummary] = useState(false)

  useEffect(() => {
    if (stats.weeklyInsight) {
      setSummaryText(stats.weeklyInsight)
    }
  }, [stats.weeklyInsight])

  const handleFetchWeeklySummary = async () => {
    setLoadingSummary(true)
    try {
      const summary = await generateWeeklySummary(stats)
      setSummaryText(summary)
    } catch (e) {
      console.error('Weekly summary error:', e)
    } finally {
      setLoadingSummary(false)
    }
  }

  if (!hasData) {
    return (
      <div className="flex flex-col flex-1 overflow-y-auto" style={{ background: day.bg }}>
        <div className="px-6 py-8">
          <div className="flex items-center gap-2 mb-6">
            <svg viewBox="0 0 24 24" fill={day.accent} className="w-6 h-6"><circle cx="12" cy="12" r="5" /></svg>
            <span style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 700, fontSize: '22px', color: day.text, letterSpacing: '-0.02em' }}>NightNote</span>
          </div>
          <h2 style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 800, fontSize: '26px', color: day.text, letterSpacing: '-0.03em', marginBottom: '6px' }}>Track Your Progress!</h2>

          {/* Plant empty state */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '48px 0 24px', textAlign: 'center' }}>
            <svg viewBox="0 0 100 120" width={110} height={132} style={{ marginBottom: '24px' }}>
              {/* Pot */}
              <path d="M30 95 L35 115 L65 115 L70 95 Z" fill="#c8956a" />
              <rect x="26" y="90" width="48" height="8" rx="3" fill="#b5835a" />
              {/* Soil */}
              <ellipse cx="50" cy="92" rx="22" ry="6" fill="#6b4226" />
              {/* Stem */}
              <line x1="50" y1="90" x2="50" y2="55" stroke="#4a7c59" strokeWidth="3.5" strokeLinecap="round" />
              {/* Leaves */}
              <path d="M50 72 Q38 60 32 48 Q44 54 50 65" fill="#5a9c6e" />
              <path d="M50 68 Q62 56 68 44 Q56 50 50 62" fill="#4a8a5e" />
              <path d="M50 58 Q40 50 36 40 Q46 46 50 54" fill="#5a9c6e" opacity="0.8" />
              {/* Tiny sprout at top */}
              <path d="M50 55 Q46 46 42 42" fill="none" stroke="#5a9c6e" strokeWidth="2.5" strokeLinecap="round" />
              <path d="M50 55 Q54 46 58 42" fill="none" stroke="#4a8a5e" strokeWidth="2.5" strokeLinecap="round" />
              {/* Sparkles */}
              <text x="72" y="52" style={{ fontSize: '14px' }}>✦</text>
              <text x="16" y="60" style={{ fontSize: '10px', fill: '#f5c842' }}>✧</text>
            </svg>
            <h3 style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 700, fontSize: '18px', color: day.text, marginBottom: '8px' }}>
              Just getting started!
            </h3>
            <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: '14px', color: day.textDim, lineHeight: 1.65, maxWidth: '240px' }}>
              Complete today's mission to start tracking your consistency.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col flex-1 overflow-y-auto" style={{ background: day.bg }}>
      <div className="px-6 py-8">
        <div className="flex items-center gap-2 mb-6">
          <svg viewBox="0 0 24 24" fill={day.accent} className="w-6 h-6"><circle cx="12" cy="12" r="5" /></svg>
          <span style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 700, fontSize: '22px', color: day.text, letterSpacing: '-0.02em' }}>NightNote</span>
        </div>
        <h2 style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 800, fontSize: '26px', color: day.text, letterSpacing: '-0.03em', marginBottom: '6px' }}>Track Your Progress!</h2>
        <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: '13px', color: day.textDim, marginBottom: '28px' }}>This week · {new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</p>

        <div className="p-5 rounded-2xl mb-6" style={{ background: day.surface, border: `1px solid ${day.border}`, boxShadow: '0 2px 12px rgba(0,0,0,0.04)' }}>
          <h3 style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 700, fontSize: '13px', letterSpacing: '0.08em', textTransform: 'uppercase', color: day.accent, marginBottom: '20px' }}>
            Core Execution Skills
          </h3>
          <AnimatedProgressBar
            day={day}
            icon={<svg viewBox="0 0 20 20" fill="none" stroke="#5b6af7" strokeWidth={1.8} className="w-5 h-5"><circle cx="10" cy="10" r="7" /><circle cx="10" cy="10" r="3" /></svg>}
            label="Deep Focus" value={stats.deepFocus ?? 0} color="#5b6af7"
          />
          <AnimatedProgressBar
            day={day}
            icon={<svg viewBox="0 0 20 20" fill={day.accent} className="w-4 h-4"><polygon points="10,1 12,7 19,7 13,11 15,18 10,14 5,18 7,11 1,7 8,7" /></svg>}
            label="Follow-Through" value={stats.followThrough ?? 0} color={day.accent}
          />
          <AnimatedProgressBar
            day={day}
            icon={<svg viewBox="0 0 20 20" fill="none" stroke={day.green} strokeWidth={2} strokeLinecap="round" className="w-5 h-5"><polyline points="4,10 8,14 16,6" /></svg>}
            label="Planning Realism" value={stats.planningRealism ?? 0} color={day.green}
          />
        </div>

        <div className="p-5 rounded-2xl" style={{ background: day.surface, border: `1px solid ${day.border}`, boxShadow: '0 2px 12px rgba(0,0,0,0.04)' }}>
          <div className="flex items-center justify-between mb-4">
            <h3 style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 700, fontSize: '15px', color: day.text }}>Consistency</h3>
            <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: '12px', color: day.textDim }}>Mon – Sun</span>
          </div>
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={stats.weeklyData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={day.border} />
              <XAxis dataKey="day" tick={{ fontFamily: "'DM Sans', sans-serif", fontSize: 11, fill: day.textDim }} axisLine={false} tickLine={false} />
              <YAxis hide />
              <Tooltip contentStyle={{ fontFamily: "'DM Sans', sans-serif", fontSize: '12px', borderRadius: '10px', border: `1px solid ${day.border}`, background: day.surface, color: day.text }} />
              <Line type="monotone" dataKey="consistency" stroke={day.green} strokeWidth={2.5} dot={{ fill: day.green, r: 3 }} activeDot={{ r: 5 }} name="Consistency" />
              <Line type="monotone" dataKey="focus" stroke="#5b6af7" strokeWidth={2.5} dot={{ fill: '#5b6af7', r: 3 }} activeDot={{ r: 5 }} name="Focus" strokeDasharray="5 3" />
            </LineChart>
          </ResponsiveContainer>
          <div className="flex gap-4 mt-3">
            {[{ color: day.green, label: 'Consistency' }, { color: '#5b6af7', label: 'Focus', dashed: true }].map((l) => (
              <div key={l.label} className="flex items-center gap-2">
                <div style={{ width: '20px', height: '2px', background: l.dashed ? 'transparent' : l.color, borderTop: l.dashed ? `2px dashed ${l.color}` : undefined, borderRadius: '99px' }} />
                <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: '11px', color: day.textDim }}>{l.label}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="flex gap-3 mt-4">
          {[{ label: 'Tasks Done', value: stats.tasksDone }, { label: 'Streak', value: stats.streak, suffix: 'd' }, { label: 'Notes', value: stats.notes }].map((s) => (
            <div key={s.label} className="flex-1 p-3 rounded-xl text-center flex flex-col items-center justify-center" style={{ background: day.surface, border: `1px solid ${day.border}` }}>
              <div className="flex items-center gap-1">
                <p style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 800, fontSize: '20px', color: day.accent }}>{s.value}</p>
                {s.suffix && <p style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 800, fontSize: '20px', color: day.accent }}>{s.suffix}</p>}
                {s.label === 'Streak' && (
                  <span style={{ fontSize: '14px', animation: 'floatMoon 2s ease-in-out infinite', display: 'inline-block' }}>🔥</span>
                )}
              </div>
              <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: '11px', color: day.textDim, marginTop: '2px' }}>{s.label}</p>
            </div>
          ))}
        </div>

        <div className="mt-6 p-5 rounded-2xl relative overflow-hidden shadow-sm" style={{ background: `linear-gradient(135deg, ${day.accent} 0%, #d4802a 100%)` }}>
          <div style={{ position: 'relative', zIndex: 1 }}>
            <h3 style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 700, fontSize: '16px', color: '#fff', marginBottom: '8px' }}>
              Weekly AI Summary
            </h3>
            <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: '14px', color: 'rgba(255,255,255,0.95)', lineHeight: 1.5, marginBottom: '16px' }}>
              {loadingSummary ? '⚡ Analyzing week with Groq AI…' : summaryText}
            </p>
            <button
              onClick={handleFetchWeeklySummary}
              disabled={loadingSummary}
              style={{ background: 'rgba(255,255,255,0.2)', border: 'none', borderRadius: '10px', padding: '8px 16px', color: '#fff', fontFamily: "'Outfit', sans-serif", fontWeight: 600, fontSize: '13px', cursor: 'pointer', transition: 'background 0.2s' }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.3)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.2)'}
            >
              {loadingSummary ? 'Generating…' : 'Refresh Summary (Groq AI) →'}
            </button>
          </div>
          {/* Decorative background shapes */}
          <div style={{ position: 'absolute', right: '-20px', top: '-20px', width: '100px', height: '100px', borderRadius: '50%', background: 'rgba(255,255,255,0.1)' }} />
          <div style={{ position: 'absolute', right: '40px', bottom: '-30px', width: '80px', height: '80px', borderRadius: '50%', background: 'rgba(255,255,255,0.1)' }} />
        </div>
      </div>
    </div>
  )
}

// ─── Settings Screen ──────────────────────────────────────────────────────────

function Toggle({ value, onChange, accentColor, day = lightDayTheme }: { value: boolean; onChange: (v: boolean) => void; accentColor?: string; day?: DayTheme }) {
  const accent = accentColor || day.accent
  return (
    <button onClick={() => onChange(!value)}
      style={{ width: '44px', height: '24px', borderRadius: '99px', background: value ? accent : day.border, border: 'none', cursor: 'pointer', position: 'relative', transition: 'background 0.25s', flexShrink: 0 }}>
      <span style={{ position: 'absolute', top: '2px', left: value ? '22px' : '2px', width: '20px', height: '20px', borderRadius: '50%', background: '#fff', boxShadow: '0 1px 4px rgba(0,0,0,0.2)', transition: 'left 0.25s' }} />
    </button>
  )
}

function SettingRow({ icon, label, sub, right, day = lightDayTheme }: { icon: React.ReactNode; label: string; sub?: string; right: React.ReactNode; day?: DayTheme }) {
  return (
    <div className="flex items-center gap-3 py-4" style={{ borderBottom: `1px solid ${day.border}` }}>
      <div className="flex items-center justify-center rounded-xl" style={{ width: '36px', height: '36px', background: day.surfaceAlt, flexShrink: 0 }}>{icon}</div>
      <div className="flex-1 min-w-0">
        <p style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 500, fontSize: '15px', color: day.text }}>{label}</p>
        {sub && <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: '12px', color: day.textDim, marginTop: '1px' }}>{sub}</p>}
      </div>
      <div className="flex-shrink-0">{right}</div>
    </div>
  )
}

function SectionHeader({ title, day = lightDayTheme }: { title: string; day?: DayTheme }) {
  return (
    <p style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 700, fontSize: '11px', letterSpacing: '0.1em', textTransform: 'uppercase', color: day.accent, marginTop: '24px', marginBottom: '2px', paddingLeft: '2px' }}>
      {title}
    </p>
  )
}

function SettingsScreen({
  settings,
  onUpdateSettings,
  onReset,
  onOpenApiKeyModal,
  day = lightDayTheme,
}: {
  settings: AppSettings
  onUpdateSettings: (s: AppSettings) => void
  onReset: () => void
  onOpenApiKeyModal?: () => void
  day?: DayTheme
}) {
  const [showResetConfirm, setShowResetConfirm] = useState(false)
  const [resetDone, setResetDone] = useState(false)

  const confirmReset = () => {
    onReset()
    setResetDone(true)
    setShowResetConfirm(false)
    setTimeout(() => setResetDone(false), 3000)
  }

  const updateSetting = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    onUpdateSettings({ ...settings, [key]: value })
  }

  const ip = { width: 18, height: 18, stroke: day.accent, fill: 'none', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }

  return (
    <div className="flex flex-col flex-1 overflow-y-auto" style={{ background: day.bg }}>
      <div className="px-6 py-8 pb-4">
        <div className="flex items-center gap-2 mb-6">
          <svg viewBox="0 0 24 24" fill={day.accent} className="w-6 h-6"><circle cx="12" cy="12" r="3" /></svg>
          <span style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 700, fontSize: '22px', color: day.text, letterSpacing: '-0.02em' }}>NightNote</span>
        </div>
        <h2 style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 800, fontSize: '26px', color: day.text, letterSpacing: '-0.03em', marginBottom: '4px' }}>Settings</h2>
        <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: '13px', color: day.textDim, marginBottom: '8px' }}>Tailor NightNote to your rhythm</p>

        <SectionHeader title="Capture" day={day} />
        <div className="rounded-2xl overflow-hidden px-4" style={{ background: day.surface, border: `1px solid ${day.border}` }}>
          <SettingRow day={day} icon={<svg viewBox="0 0 24 24" {...ip}><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>}
            label="Nightly Reminder" sub="When should we prompt you?"
            right={<input type="time" value={settings.reminderTime} onChange={(e) => updateSetting('reminderTime', e.target.value)} style={{ background: day.surfaceAlt, border: `1px solid ${day.border}`, borderRadius: '8px', padding: '6px 10px', fontFamily: "'DM Sans', sans-serif", fontSize: '14px', color: day.text, outline: 'none', cursor: 'pointer' }} />}
          />
          <SettingRow day={day} icon={<svg viewBox="0 0 24 24" {...ip}><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /></svg>}
            label="Default Input Mode" sub="How you prefer to capture"
            right={
              <div className="flex rounded-xl overflow-hidden" style={{ border: `1px solid ${day.border}` }}>
                {(['Voice', 'Text'] as const).map((m) => (
                  <button key={m} onClick={() => updateSetting('inputMode', m)} style={{ padding: '6px 14px', background: settings.inputMode === m ? day.accent : 'transparent', color: settings.inputMode === m ? '#fff' : day.textDim, fontFamily: "'DM Sans', sans-serif", fontSize: '13px', fontWeight: 600, border: 'none', cursor: 'pointer', transition: 'all 0.2s' }}>{m}</button>
                ))}
              </div>
            }
          />
        </div>

        <SectionHeader title="Appearance" day={day} />
        <div className="rounded-2xl overflow-hidden px-4" style={{ background: day.surface, border: `1px solid ${day.border}` }}>
          <SettingRow day={day} icon={<svg viewBox="0 0 24 24" {...ip}><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></svg>}
            label="Dark Mode" sub="Enable dark theme for day screens"
            right={<Toggle day={day} value={settings.darkTheme} onChange={(v) => updateSetting('darkTheme', v)} />}
          />
        </div>

        <SectionHeader title="Intelligence" day={day} />
        <div className="rounded-2xl overflow-hidden px-4" style={{ background: day.surface, border: `1px solid ${day.border}` }}>
          <SettingRow day={day} icon={<svg viewBox="0 0 24 24" {...ip}><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" /></svg>}
            label="Groq AI Engine" sub="Active & Auto-Initialized (Demo Build)"
            right={
              <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: '12px', fontWeight: 600, color: day.green }}>
                ● Ready
              </span>
            }
          />
        </div>

        <SectionHeader title="Account" day={day} />
        <div className="rounded-2xl overflow-hidden px-4" style={{ background: day.surface, border: `1px solid ${day.border}` }}>
          <SettingRow day={day} icon={<svg viewBox="0 0 24 24" {...ip}><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>}
            label="Local Profile" sub="Stored in Local Storage"
            right={<span style={{ fontFamily: "'DM Sans'", fontSize: '22px', color: day.textDim, lineHeight: 1 }}>›</span>}
          />
        </div>

        <SectionHeader title="Progress" day={day} />
        <div className="rounded-2xl overflow-hidden px-4" style={{ background: day.surface, border: `1px solid ${day.border}` }}>
          {!showResetConfirm && !resetDone ? (
            <button onClick={() => setShowResetConfirm(true)} className="w-full flex items-center gap-3 py-4" style={{ border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left' }}>
              <div className="flex items-center justify-center rounded-xl" style={{ width: '36px', height: '36px', background: 'rgba(212,74,58,0.08)', flexShrink: 0 }}>
                <svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke={day.red} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 .49-4.7" /></svg>
              </div>
              <span style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 500, fontSize: '15px', color: day.red }}>Reset Consistency Score</span>
            </button>
          ) : resetDone ? (
            <div className="py-4 flex items-center gap-3">
              <div className="flex items-center justify-center rounded-xl" style={{ width: '36px', height: '36px', background: day.greenBg, flexShrink: 0 }}>
                <svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke={day.green} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
              </div>
              <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: '15px', color: day.green, fontWeight: 500 }}>Score reset successfully</span>
            </div>
          ) : (
            <div className="py-4">
              <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: '14px', color: day.text, marginBottom: '12px' }}>Are you sure? This will clear your streak and all weekly data.</p>
              <div className="flex gap-3">
                <button onClick={() => setShowResetConfirm(false)} style={{ flex: 1, padding: '10px', borderRadius: '12px', border: `1px solid ${day.border}`, background: 'transparent', fontFamily: "'Outfit', sans-serif", fontWeight: 600, fontSize: '14px', color: day.textDim, cursor: 'pointer' }}>Cancel</button>
                <button onClick={confirmReset} style={{ flex: 1, padding: '10px', borderRadius: '12px', border: 'none', background: day.red, fontFamily: "'Outfit', sans-serif", fontWeight: 600, fontSize: '14px', color: '#fff', cursor: 'pointer' }}>Reset</button>
              </div>
            </div>
          )}
        </div>

        <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: '12px', color: day.textDim, textAlign: 'center', marginTop: '32px', marginBottom: '8px' }}>
          NightNote v1.0
        </p>
      </div>
    </div>
  )
}

// ─── API Key Setup Modal ──────────────────────────────────────────────────────

function ApiKeyModal({
  errorMsg,
  onSaveKey,
  onUseOffline,
  onClose,
  day = lightDayTheme,
}: {
  errorMsg: string | null
  onSaveKey: (key: string) => void
  onUseOffline: () => void
  onClose: () => void
  day?: DayTheme
}) {
  const [keyInput, setKeyInput] = useState(() => localStorage.getItem('GROQ_API_KEY') || '')
  const isDark = day.bg === darkDayTheme.bg

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: isDark ? 'rgba(15,23,42,0.85)' : 'rgba(247,244,238,0.85)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 70,
        padding: '24px',
        animation: 'overlayIn 0.3s ease',
      }}
    >
      <div
        style={{
          width: '100%',
          background: day.surface,
          borderRadius: '24px',
          border: `1px solid ${day.border}`,
          boxShadow: isDark ? '0 24px 64px rgba(0,0,0,0.6)' : '0 24px 64px rgba(0,0,0,0.12)',
          padding: '28px 24px',
          animation: 'modalIn 0.35s cubic-bezier(0.34, 1.56, 0.64, 1)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
          <span style={{ fontSize: '24px' }}>⚡</span>
          <h3 style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 700, fontSize: '20px', color: day.text }}>
            Groq AI Key Setup
          </h3>
        </div>

        <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: '13px', color: day.textDim, lineHeight: 1.5, marginBottom: '16px' }}>
          NightNote uses AI to convert your night thoughts into structured daily missions.
        </p>

        {errorMsg && (
          <div style={{ background: day.redBg, border: `1px solid ${day.red}`, borderRadius: '12px', padding: '10px 12px', color: day.red, fontSize: '12px', fontFamily: "'DM Sans', sans-serif", marginBottom: '16px' }}>
            ⚠️ {errorMsg}
          </div>
        )}

        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', fontFamily: "'Outfit', sans-serif", fontWeight: 600, fontSize: '12px', color: day.text, marginBottom: '6px' }}>
            Enter Groq API Key
          </label>
          <input
            type="password"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            placeholder="gsk_..."
            style={{
              width: '100%',
              background: day.surfaceAlt,
              border: `1px solid ${day.border}`,
              borderRadius: '12px',
              padding: '10px 14px',
              color: day.text,
              fontFamily: "'DM Sans', sans-serif",
              fontSize: '14px',
              outline: 'none',
            }}
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <button
            onClick={() => {
              if (keyInput.trim()) {
                onSaveKey(keyInput.trim())
              }
            }}
            disabled={!keyInput.trim()}
            style={{
              padding: '12px',
              borderRadius: '14px',
              border: 'none',
              background: keyInput.trim() ? day.accent : day.surfaceAlt,
              color: keyInput.trim() ? (isDark ? '#0d1b3e' : '#ffffff') : day.textDim,
              fontFamily: "'Outfit', sans-serif",
              fontWeight: 700,
              fontSize: '14px',
              cursor: keyInput.trim() ? 'pointer' : 'not-allowed',
            }}
          >
            Save Key & Generate Mission
          </button>

          <button
            onClick={onUseOffline}
            style={{
              padding: '12px',
              borderRadius: '14px',
              border: `1px solid ${day.border}`,
              background: day.surfaceAlt,
              color: day.text,
              fontFamily: "'Outfit', sans-serif",
              fontWeight: 600,
              fontSize: '14px',
              cursor: 'pointer',
            }}
          >
            ⚡ Use Smart Local Planning
          </button>

          <button
            onClick={onClose}
            style={{
              padding: '8px',
              border: 'none',
              background: 'transparent',
              color: day.textDim,
              fontFamily: "'DM Sans', sans-serif",
              fontSize: '12px',
              cursor: 'pointer',
              marginTop: '2px',
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

function MorningLockedModal({ onClose, day = lightDayTheme }: { onClose: () => void; day?: DayTheme }) {
  const isDark = day.bg === darkDayTheme.bg
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: isDark ? 'rgba(15,23,42,0.85)' : 'rgba(247,244,238,0.85)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 60,
        padding: '24px',
        animation: 'overlayIn 0.3s ease',
      }}
    >
      <div
        style={{
          width: '100%',
          background: day.surface,
          borderRadius: '24px',
          border: `1px solid ${day.border}`,
          padding: '28px 24px',
          textAlign: 'center',
          boxShadow: isDark ? '0 20px 40px rgba(0,0,0,0.5)' : '0 20px 40px rgba(0,0,0,0.1)',
        }}
      >
        <div style={{ fontSize: '38px', marginBottom: '12px' }}>🌙</div>
        <h3 style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 700, fontSize: '20px', color: day.text, marginBottom: '8px' }}>
          Rest well tonight.
        </h3>
        <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: '14px', color: day.textDim, lineHeight: 1.5, marginBottom: '24px' }}>
          Your mission is saved and will be ready for you in the morning at 5:00 AM. Sleep tight!
        </p>
        <button
          onClick={onClose}
          style={{
            width: '100%',
            background: day.accent,
            color: isDark ? '#0d1b3e' : '#ffffff',
            padding: '12px',
            borderRadius: '12px',
            fontFamily: "'Outfit', sans-serif",
            fontWeight: 700,
            fontSize: '15px',
            border: 'none',
            cursor: 'pointer',
          }}
        >
          Return to Night Note
        </button>
      </div>
    </div>
  )
}

// ─── App Shell ────────────────────────────────────────────────────────────────

export default function App() {
  const [screen, setScreen] = useState<Screen>('night')
  const [settings, setSettings] = useState<AppSettings>(getSettings)
  const [showAILoading, setShowAILoading] = useState(false)
  const [showMissionReady, setShowMissionReady] = useState(false)
  const [showMissionComplete, setShowMissionComplete] = useState(false)
  const [showApiKeyModal, setShowApiKeyModal] = useState(false)
  const [showMorningLockedModal, setShowMorningLockedModal] = useState(false)
  const [apiKeyErrorMsg, setApiKeyErrorMsg] = useState<string | null>(null)

  const handleUpdateSettings = useCallback((newSettings: AppSettings) => {
    setSettings(newSettings)
    saveSettings(newSettings)
  }, [])

  const day = getDayTheme(settings.darkTheme)

  const todayStr = new Date().toDateString()
  const todayDayName = new Date().toLocaleDateString('en-US', { weekday: 'short' })
  const [nightEntryDate, setNightEntryDate] = useState(() => localStorage.getItem('nightEntryDate') || '')
  const [missionCompleteDate, setMissionCompleteDate] = useState(() => localStorage.getItem('missionCompleteDate') || '')
  const [dismissedDialog, setDismissedDialog] = useState(false)
  
  const [stats, setStats] = useState<ProgressStats>(getStats)

  const handleResetData = useCallback(() => {
    localStorage.removeItem('progressStats')
    localStorage.removeItem('morningTasks')
    localStorage.removeItem('nightEntryDate')
    localStorage.removeItem('missionCompleteDate')
    localStorage.removeItem('nightEntryThought')
    setStats(DEFAULT_STATS)
    setNightEntryDate('')
    setMissionCompleteDate('')
    setDismissedDialog(false)
  }, [])

  const isNightLocked = DEMO_MODE ? false : (nightEntryDate !== '' && nightEntryDate !== todayStr && missionCompleteDate !== todayStr);
  const showAlreadyPlannedDialog = DEMO_MODE ? false : (nightEntryDate === todayStr && !dismissedDialog);

  const isMorningUnlocked = useCallback(() => {
    if (DEMO_MODE) return true
    const nightDate = localStorage.getItem('nightEntryDate') || ''
    const currentHour = new Date().getHours()

    if (!nightDate || nightDate !== todayStr) return true
    if (currentHour >= 5 && currentHour < 22) return true
    if (missionCompleteDate === todayStr) return true

    return false
  }, [todayStr, missionCompleteDate])

  const handleTabChange = useCallback((s: Screen) => {
    if (s === 'morning') {
      if (!isMorningUnlocked()) {
        setShowMorningLockedModal(true)
        return
      }
    }
    setScreen(s)
  }, [isMorningUnlocked])

  const isNight = screen === 'night'

  const handleGenerateMission = useCallback(async (thought: string) => {
    setShowAILoading(true)
    
    try {
      const generatedTasks = await generateMission(thought)
      localStorage.setItem('morningTasks', JSON.stringify(generatedTasks))
      localStorage.setItem('nightEntryDate', todayStr)
      setNightEntryDate(todayStr)
      
      incrementNotes()
      setStats(getStats())
      
      setShowAILoading(false)
      setShowMissionReady(true)
    } catch (error: any) {
      console.warn('Mission generation fallback:', error)
      setShowAILoading(false)
      const generatedTasks = generateLocalTasks(thought)
      localStorage.setItem('morningTasks', JSON.stringify(generatedTasks))
      localStorage.setItem('nightEntryDate', todayStr)
      setNightEntryDate(todayStr)
      
      incrementNotes()
      setStats(getStats())
      setShowMissionReady(true)
    }
  }, [todayStr])

  const handleSaveApiKey = useCallback((key: string) => {
    setSessionGroqApiKey(key)
    setShowApiKeyModal(false)
    setApiKeyErrorMsg(null)
    const storedThought = localStorage.getItem('nightEntryThought') || ''
    if (storedThought) {
      handleGenerateMission(storedThought)
    }
  }, [handleGenerateMission])

  const handleUseOfflineMode = useCallback(() => {
    setShowApiKeyModal(false)
    setApiKeyErrorMsg(null)
    const storedThought = localStorage.getItem('nightEntryThought') || 'Plan my day and stay focused'
    const generatedTasks = generateLocalTasks(storedThought)
    
    localStorage.setItem('morningTasks', JSON.stringify(generatedTasks))
    localStorage.setItem('nightEntryDate', todayStr)
    setNightEntryDate(todayStr)
    
    incrementNotes()
    setStats(getStats())
    setShowMissionReady(true)
  }, [todayStr])

  const handleMissionReadyClose = useCallback(() => {
    setShowMissionReady(false)
    setDismissedDialog(false)
    setScreen('night')
  }, [])

  const handleEditThoughts = useCallback(() => {
    setShowMissionReady(false)
    setScreen('night')
    setDismissedDialog(true)
  }, [])

  const handleAllComplete = useCallback((taskCount: number) => {
    if (missionCompleteDate !== todayStr) {
      localStorage.setItem('missionCompleteDate', todayStr)
      setMissionCompleteDate(todayStr)
      recordMissionComplete(taskCount, todayStr, todayDayName)
      setStats(getStats())
    }
    setShowMissionComplete(true)
  }, [todayStr, todayDayName, missionCompleteDate])

  const handleViewProgress = useCallback(() => {
    setShowMissionComplete(false)
    setScreen('progress')
  }, [])

  const handleMissionCompleteHome = useCallback(() => {
    setShowMissionComplete(false)
    setScreen('morning')
  }, [])

  const navigate = useCallback((s: Screen) => handleTabChange(s), [handleTabChange])

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        width: '100%',
        height: '100vh',
        height: '100dvh',
        background: isNight
          ? night.bg
          : (settings.darkTheme ? darkDayTheme.bg : lightDayTheme.bg),
        fontFamily: "'DM Sans', sans-serif",
        transition: 'background 0.4s ease',
      }}
    >
      {/* App container */}
      <div
        style={{
          width: '100%',
          maxWidth: '480px',
          height: '100%',
          maxHeight: '100vh',
          maxHeight: '100dvh',
          background: isNight ? night.bg : day.bg,
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
          transition: 'background 0.4s ease',
          paddingTop: 'env(safe-area-inset-top, 0px)',
        }}
      >
        {/* Screen content */}
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', position: 'relative' }}>
          {screen === 'night' && (
            <NightCapture 
              onGenerateMission={handleGenerateMission}
              isLocked={isNightLocked}
              showDialog={showAlreadyPlannedDialog}
              onContinueEditing={() => setDismissedDialog(true)}
              onDone={() => setDismissedDialog(true)}
              onGoToMorning={() => handleTabChange('morning')}
            />
          )}
          {screen === 'morning' && <MorningMission onAllComplete={handleAllComplete} onNavigate={navigate} onUpdateStats={setStats} day={day} />}
          {screen === 'progress' && <ProgressScreen hasData={stats.notes > 0 || stats.tasksDone > 0 || stats.weeklyData.some((d) => (d.planned || 0) > 0 || (d.completed || 0) > 0)} stats={stats} day={day} />}
          {screen === 'settings' && (
            <SettingsScreen
              settings={settings}
              onUpdateSettings={handleUpdateSettings}
              onReset={handleResetData}
              onOpenApiKeyModal={() => {
                setApiKeyErrorMsg(null)
                setShowApiKeyModal(true)
              }}
              day={day}
            />
          )}

          {/* AI Loading overlay */}
          {showAILoading && <AILoadingOverlay />}

          {/* Mission Ready Modal */}
          {showMissionReady && (
            <MissionReadyModal onClose={handleMissionReadyClose} onEditThoughts={handleEditThoughts} />
          )}

          {/* Mission Complete Modal */}
          {showMissionComplete && (
            <MissionCompleteModal onViewProgress={handleViewProgress} onHome={handleMissionCompleteHome} stats={stats} day={day} />
          )}

          {/* Morning Locked Modal */}
          {showMorningLockedModal && (
            <MorningLockedModal onClose={() => setShowMorningLockedModal(false)} day={day} />
          )}
        </div>

        {/* Bottom Nav */}
        <BottomNav active={screen} onChange={handleTabChange} isDark={isNight} day={day} />
      </div>
    </div>
  )
}
