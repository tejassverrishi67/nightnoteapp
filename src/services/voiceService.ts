// Dedicated Native & Web Voice Recognition Service for NightNote

export interface VoiceListeners {
  onStart: () => void
  onResult: (transcript: string, isFinal: boolean) => void
  onError: (errorMsg: string) => void
  onEnd: () => void
}

export class VoiceSession {
  private recognition: any = null
  private activeStream: MediaStream | null = null
  private mediaRecorder: MediaRecorder | null = null
  private isListening = false

  async requestMicrophonePermission(): Promise<boolean> {
    // 1. Check Capacitor native permissions if running in Capacitor container
    const win = window as any
    if (win.Capacitor?.Plugins?.SpeechRecognition) {
      try {
        const hasPerm = await win.Capacitor.Plugins.SpeechRecognition.hasPermission()
        if (!hasPerm?.permission) {
          const req = await win.Capacitor.Plugins.SpeechRecognition.requestPermission()
          if (!req?.permission) return false
        }
        return true
      } catch (e) {
        console.warn('Capacitor SpeechRecognition permission check fallback:', e)
      }
    }

    // 2. Browser & Android WebView getUserMedia permission prompt
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        // Keep stream reference or stop temporary track
        stream.getTracks().forEach((track) => track.stop())
        return true
      } catch (err: any) {
        console.warn('getUserMedia mic permission error:', err)
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          return false
        }
        // Try to proceed if error was non-fatal
        return true
      }
    }

    return true
  }

  async startListening(listeners: VoiceListeners): Promise<void> {
    if (this.isListening) {
      this.stopListening()
    }

    const hasPermission = await this.requestMicrophonePermission()
    if (!hasPermission) {
      listeners.onError('Microphone permission denied. Tap mic again to allow or type your thoughts below.')
      return
    }

    const win = window as any

    // Option A: Capacitor Native Speech Recognition Plugin
    if (win.Capacitor?.Plugins?.SpeechRecognition) {
      try {
        await win.Capacitor.Plugins.SpeechRecognition.start({
          language: 'en-US',
          maxResults: 5,
          prompt: 'Speak your night thoughts...',
          partialResults: true,
          popup: false,
        })

        this.isListening = true
        listeners.onStart()

        win.Capacitor.Plugins.SpeechRecognition.addListener('partialResults', (data: any) => {
          if (data.matches && data.matches.length > 0) {
            listeners.onResult(data.matches[0], false)
          }
        })

        return
      } catch (e: any) {
        console.warn('Capacitor native speech start failed, falling back to Web Speech API:', e)
      }
    }

    // Option B: Web Speech API (Chrome, Safari, Android WebViews)
    const SpeechRecognition = win.SpeechRecognition || win.webkitSpeechRecognition

    if (SpeechRecognition) {
      try {
        const recognition = new SpeechRecognition()
        recognition.continuous = true
        recognition.interimResults = true
        recognition.lang = 'en-US'

        recognition.onstart = () => {
          this.isListening = true
          listeners.onStart()
        }

        recognition.onresult = (event: any) => {
          let interimStr = ''
          let finalStr = ''

          for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript
            if (event.results[i].isFinal) {
              finalStr += transcript
            } else {
              interimStr += transcript
            }
          }

          if (finalStr) {
            listeners.onResult(finalStr, true)
          } else if (interimStr) {
            listeners.onResult(interimStr, false)
          }
        }

        recognition.onerror = (event: any) => {
          console.warn('Speech recognition error event:', event.error)
          this.isListening = false

          if (event.error === 'not-allowed') {
            listeners.onError('Microphone access blocked. Tap mic again to allow access or type below.')
          } else if (event.error === 'no-speech') {
            listeners.onError('No speech detected. Speak clearly or tap mic again.')
          } else if (event.error === 'audio-capture') {
            listeners.onError('No microphone found on your device. Type your thoughts below.')
          } else if (event.error !== 'aborted') {
            listeners.onError('Voice capture interrupted. Tap mic to retry or type below.')
          }
          listeners.onEnd()
        }

        recognition.onend = () => {
          this.isListening = false
          listeners.onEnd()
        }

        this.recognition = recognition
        recognition.start()
        return
      } catch (err: any) {
        console.warn('SpeechRecognition initialization error:', err)
      }
    }

    // Option C: MediaRecorder Listening Fallback (For WebViews without built-in STT engine)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      this.activeStream = stream
      this.isListening = true
      listeners.onStart()

      // Active audio visualizer stream indicator
      const mediaRecorder = new MediaRecorder(stream)
      this.mediaRecorder = mediaRecorder

      mediaRecorder.onstop = () => {
        this.isListening = false
        if (this.activeStream) {
          this.activeStream.getTracks().forEach((t) => t.stop())
          this.activeStream = null
        }
        listeners.onEnd()
      }

      mediaRecorder.start()
      listeners.onError('Voice recording active. Speak your thoughts and type or edit below.')
    } catch (fallbackErr: any) {
      this.isListening = false
      listeners.onError('Voice input is unavailable. Please type your thoughts in the text box below.')
      listeners.onEnd()
    }
  }

  stopListening(): void {
    const win = window as any

    if (win.Capacitor?.Plugins?.SpeechRecognition) {
      try {
        win.Capacitor.Plugins.SpeechRecognition.stop()
        win.Capacitor.Plugins.SpeechRecognition.removeAllListeners()
      } catch (e) {
        console.warn(e)
      }
    }

    if (this.recognition) {
      try {
        this.recognition.stop()
      } catch (e) {
        console.warn(e)
      }
      this.recognition = null
    }

    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      try {
        this.mediaRecorder.stop()
      } catch (e) {
        console.warn(e)
      }
      this.mediaRecorder = null
    }

    if (this.activeStream) {
      this.activeStream.getTracks().forEach((t) => t.stop())
      this.activeStream = null
    }

    this.isListening = false
  }
}
