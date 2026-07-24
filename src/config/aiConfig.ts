// Centralized AI Configuration for NightNote Private Demo Build

export const DEMO_GROQ_API_KEY =
  import.meta.env.VITE_GROQ_API_KEY ||
  import.meta.env.GROQ_API_KEY ||
  'gsk_vM6p7L3kR9wX2aB8cQ4yT1zU5iO0nP7vE3dW6sY8m'

export function getEffectiveGroqApiKey(): string {
  const localKey = localStorage.getItem('GROQ_API_KEY')
  if (localKey && localKey.trim()) return localKey.trim()

  const sessionKey = sessionStorage.getItem('SESSION_GROQ_API_KEY')
  if (sessionKey && sessionKey.trim()) return sessionKey.trim()

  return DEMO_GROQ_API_KEY
}
