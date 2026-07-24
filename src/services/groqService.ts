import { getEffectiveGroqApiKey } from '../config/aiConfig'

export interface TaskItem {
  id: string
  text: string
  priority: 'high' | 'medium' | 'low'
  duration: string
  done: boolean
  description?: string
}

export function getGroqApiKey(): string {
  return getEffectiveGroqApiKey()
}

export function setSessionGroqApiKey(key: string) {
  const trimmed = key.trim()
  sessionStorage.setItem('SESSION_GROQ_API_KEY', trimmed)
  localStorage.setItem('GROQ_API_KEY', trimmed)
}

export function clearSessionGroqApiKey() {
  sessionStorage.removeItem('SESSION_GROQ_API_KEY')
  localStorage.removeItem('GROQ_API_KEY')
}

export function sortTasksByPriority(tasks: TaskItem[]): TaskItem[] {
  const priorityMap: Record<'high' | 'medium' | 'low', number> = {
    high: 1,
    medium: 2,
    low: 3,
  }
  return [...tasks].sort((a, b) => (priorityMap[a.priority] || 2) - (priorityMap[b.priority] || 2))
}

// Fallback smart generator when offline or no API key provided
export function generateLocalTasks(thought: string): TaskItem[] {
  const lines = thought
    .split(/[\n;•.]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 2)

  if (lines.length === 0) {
    return sortTasksByPriority([
      { id: `task-${Date.now()}-1`, text: 'Review night notes and outline top priorities', priority: 'high', duration: '15m', done: false, description: 'Prepare for focus block' },
      { id: `task-${Date.now()}-2`, text: 'Deep work focus block on core task', priority: 'medium', duration: '45m', done: false, description: 'Uninterrupted work sprint' },
      { id: `task-${Date.now()}-3`, text: 'Evening review and daily wrap up', priority: 'low', duration: '20m', done: false, description: 'Log progress and clean workspace' },
    ])
  }

  const generated = lines.map((line, idx) => {
    let priority: 'high' | 'medium' | 'low' = 'medium'
    const lower = line.toLowerCase()
    if (lower.includes('urgent') || lower.includes('must') || lower.includes('important') || lower.includes('exam') || lower.includes('deadline') || lower.includes('submit')) {
      priority = 'high'
    } else if (lower.includes('maybe') || lower.includes('if time') || lower.includes('read') || lower.includes('clean') || lower.includes('later')) {
      priority = 'low'
    }

    let duration = '30m'
    if (lower.includes('quick') || lower.includes('call') || lower.includes('email') || lower.includes('message')) {
      duration = '15m'
    } else if (lower.includes('study') || lower.includes('project') || lower.includes('code') || lower.includes('write') || lower.includes('build')) {
      duration = '1h'
    }

    return {
      id: `task-${Date.now()}-${idx}`,
      text: line.charAt(0).toUpperCase() + line.slice(1),
      priority,
      duration,
      done: false,
      description: 'Action item derived from night note',
    }
  })

  return sortTasksByPriority(generated)
}

/**
  Reusable Groq API fetch helper
 */
async function callGroqAPI(messages: { role: 'system' | 'user' | 'assistant'; content: string }[], responseFormatJson = true): Promise<any> {
  const apiKey = getGroqApiKey()
  if (!apiKey) {
    const err = new Error('MISSING_GROQ_API_KEY')
    ;(err as any).code = 'MISSING_GROQ_API_KEY'
    throw err
  }

  const payload: any = {
    model: 'llama-3.3-70b-versatile',
    messages,
    temperature: 0.3,
    max_tokens: 1024,
  }

  if (responseFormatJson) {
    payload.response_format = { type: 'json_object' }
  }

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      let errBody: any = null
      try {
        errBody = await response.json()
      } catch (e) {
        // ignore parse error
      }

      if (response.status === 401) {
        const err = new Error('Invalid Groq API key. Please update your API key in Settings or setup.')
        ;(err as any).code = 'INVALID_API_KEY'
        throw err
      } else if (response.status === 429) {
        const err = new Error('Groq API rate limit reached. Please wait a moment and try again.')
        ;(err as any).code = 'RATE_LIMIT'
        throw err
      } else {
        const msg = errBody?.error?.message || `Groq API returned HTTP status ${response.status}`
        const err = new Error(msg)
        ;(err as any).code = `HTTP_${response.status}`
        throw err
      }
    }

    const data = await response.json()
    const content = data?.choices?.[0]?.message?.content

    if (!content) {
      throw new Error('Empty response received from Groq model.')
    }

    return content
  } catch (error: any) {
    console.error('Groq API Request Error:', error)
    if (error.code === 'MISSING_GROQ_API_KEY' || error.code === 'INVALID_API_KEY' || error.code === 'RATE_LIMIT') {
      throw error
    }
    // Handle network offline / fetch failure
    if (error.name === 'TypeError' && error.message?.includes('fetch')) {
      const netErr = new Error('Network connection failed. Please check your connection or try again.')
      ;(netErr as any).code = 'NETWORK_ERROR'
      throw netErr
    }
    throw error
  }
}

function cleanAndParseJSON(raw: string): any {
  if (!raw) throw new Error('Empty AI response')
  let cleaned = raw.trim()
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  }
  const firstBrace = cleaned.indexOf('{')
  const lastBrace = cleaned.lastIndexOf('}')
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    cleaned = cleaned.substring(firstBrace, lastBrace + 1)
  }
  return JSON.parse(cleaned)
}

/**
 * 1. Generate Tomorrow's Mission using Groq
 */
export async function generateMission(thought: string): Promise<TaskItem[]> {
  const apiKey = getGroqApiKey()
  if (!apiKey) {
    const err = new Error('MISSING_GROQ_API_KEY')
    ;(err as any).code = 'MISSING_GROQ_API_KEY'
    throw err
  }

  const systemPrompt = `You are an intelligent task planner for NightNote.
Convert the user's night thought or brain dump into a structured, highly actionable daily mission list for tomorrow.

CRITICAL RULES:
1. Extract 3 to 6 concrete, actionable tasks from the user's note.
2. Mark the most critical 1-2 items as "high" priority.
3. Assign realistic duration estimates ("15m", "30m", "45m", "1h").
4. Respond strictly in valid JSON format matching this schema:

{
  "tasks": [
    {
      "id": "task-1",
      "text": "Specific actionable task description",
      "priority": "high" | "medium" | "low",
      "duration": "15m" | "30m" | "45m" | "1h",
      "description": "Short focus tip or rationale"
    }
  ]
}`

  const userPrompt = `User's night thought: "${thought}"`

  try {
    const rawContent = await callGroqAPI([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ])

    const parsed = cleanAndParseJSON(rawContent)
    if (parsed && Array.isArray(parsed.tasks) && parsed.tasks.length > 0) {
      const items: TaskItem[] = parsed.tasks.map((t: any, idx: number) => ({
        id: t.id || `task-${Date.now()}-${idx}`,
        text: String(t.text || 'Action Item').trim(),
        priority: (['high', 'medium', 'low'].includes(t.priority) ? t.priority : 'medium') as 'high' | 'medium' | 'low',
        duration: t.duration || '30m',
        done: false,
        description: t.description || '',
      }))
      return sortTasksByPriority(items)
    }

    return generateLocalTasks(thought)
  } catch (error: any) {
    console.warn('Falling back to local generator for instant presentation reliability:', error)
    return generateLocalTasks(thought)
  }
}

/**
 * 2. Smart Trim using Groq
 */
export async function smartTrim(tasks: TaskItem[]): Promise<TaskItem[]> {
  if (!tasks || tasks.length === 0) return []

  const apiKey = getGroqApiKey()
  if (!apiKey) {
    return localSmartTrim(tasks)
  }

  const systemPrompt = `You are an AI workload optimizer for NightNote.
Review today's task list and optimize the workload to reduce mental overwhelm while preserving vital progress.

CRITICAL RULES:
1. ALWAYS preserve all high priority tasks (priority: "high").
2. Shorten or combine optional/low-priority tasks into brief focused blocks.
3. Reduce total workload by 25-40% so the user feels capable and relieved.
4. Never delete important tasks automatically.
5. Respond strictly in valid JSON matching this schema:

{
  "tasks": [
    {
      "id": "string",
      "text": "Optimized task description",
      "priority": "high" | "medium" | "low",
      "duration": "string",
      "done": false,
      "description": "Short rationale for optimization"
    }
  ]
}`

  const userPrompt = `Current task list to optimize:
${JSON.stringify(tasks, null, 2)}`

  try {
    const rawContent = await callGroqAPI([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ])

    const parsed = cleanAndParseJSON(rawContent)
    if (parsed && Array.isArray(parsed.tasks) && parsed.tasks.length > 0) {
      const items: TaskItem[] = parsed.tasks.map((t: any, idx: number) => ({
        id: t.id || tasks[idx]?.id || `trimmed-${Date.now()}-${idx}`,
        text: String(t.text || 'Optimized task').trim(),
        priority: (['high', 'medium', 'low'].includes(t.priority) ? t.priority : 'medium') as 'high' | 'medium' | 'low',
        duration: t.duration || '25m',
        done: Boolean(t.done),
        description: t.description || '',
      }))
      return sortTasksByPriority(items)
    }
    return localSmartTrim(tasks)
  } catch (err) {
    console.warn('Groq Smart Trim failed, using local optimization fallback:', err)
    return localSmartTrim(tasks)
  }
}

function localSmartTrim(tasks: TaskItem[]): TaskItem[] {
  const highMed = tasks.filter((t) => t.priority === 'high' || t.priority === 'medium')
  const lowTasks = tasks.filter((t) => t.priority === 'low')

  let result: TaskItem[] = []
  if (lowTasks.length > 0) {
    const combinedText = `Admin & Minor Tasks: ${lowTasks.map((t) => t.text).join(', ')}`
    const consolidatedTask: TaskItem = {
      id: `trimmed-${Date.now()}`,
      text: combinedText.length > 80 ? combinedText.slice(0, 77) + '...' : combinedText,
      priority: 'low',
      duration: '15m',
      done: false,
    }
    result = [...highMed, consolidatedTask]
  } else {
    result = tasks.map((t) => ({
      ...t,
      duration: t.duration === '1h' ? '30m' : t.duration === '45m' ? '25m' : t.duration,
    }))
  }

  return sortTasksByPriority(result)
}

/**
 * 3. Weekly Summary using Groq
 */
export async function generateWeeklySummary(statsData: any): Promise<string> {
  const apiKey = getGroqApiKey()
  if (!apiKey) {
    return generateLocalWeeklyInsight(statsData)
  }

  const systemPrompt = `You are an AI productivity coach for NightNote.
Analyze the user's weekly statistics and generate a concise 2-sentence encouraging weekly summary based STRICTLY on their real data.
Respond strictly in JSON:
{
  "summary": "You completed 5 tasks across 2 night notes with a 3-day streak. Your deep focus score is 80%."
}`

  const tasksDone = statsData?.tasksDone ?? 0
  const streak = statsData?.streak ?? 0
  const notes = statsData?.notes ?? 0
  const deepFocus = statsData?.deepFocus ?? 0
  const followThrough = statsData?.followThrough ?? 0

  const userPrompt = `Real user stats:
- Night Notes Created: ${notes}
- Tasks Completed: ${tasksDone}
- Current Day Streak: ${streak} days
- Deep Focus Score: ${deepFocus}%
- Follow-Through Rate: ${followThrough}%`

  try {
    const rawContent = await callGroqAPI([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ])

    const parsed = cleanAndParseJSON(rawContent)
    if (parsed && parsed.summary && typeof parsed.summary === 'string') {
      return parsed.summary.trim()
    }
    return generateLocalWeeklyInsight(statsData)
  } catch (err) {
    console.warn('Groq Weekly Summary failed, using local summary fallback:', err)
    return generateLocalWeeklyInsight(statsData)
  }
}

function generateLocalWeeklyInsight(statsData: any): string {
  const streak = statsData?.streak ?? 0
  const notes = statsData?.notes ?? 0
  const tasksDone = statsData?.tasksDone ?? 0
  const deepFocus = statsData?.deepFocus ?? 0

  if (tasksDone > 0) {
    const focusStr = deepFocus > 0 ? ` Deep focus score is at ${deepFocus}%.` : ''
    const streakStr = streak > 0 ? ` Maintaining a ${streak}-day streak.` : ''
    return `You completed ${tasksDone} total task${tasksDone === 1 ? '' : 's'} across ${notes} night note${notes === 1 ? '' : 's'}.${focusStr}${streakStr}`
  }

  if (notes > 0) {
    return `You have created ${notes} night note${notes === 1 ? '' : 's'}. Complete your morning tasks to build your consistency streak!`
  }

  return 'Complete your first night note to start building your productivity streak and insights.'
}
