import { useEffect, useState, useCallback, useRef } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import { getViewerToken, fetchDocument } from '../api/client'
import { Shield, Lock, Clock, Eye, EyeOff, Sun, Moon, FileKey2, AlertCircle } from 'lucide-react'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'
import { Input } from './ui/input'
import { Alert, AlertDescription } from './ui/alert'
import { Progress } from './ui/progress'
import ErrorMessage from './ErrorMessage'
import PDFCanvas from './PDFCanvas'

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`

interface SecureViewerProps {
  sessionId: string
}

export default function SecureViewer({ sessionId }: SecureViewerProps) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pdfDocument, setPdfDocument] = useState<pdfjsLib.PDFDocumentProxy | null>(null)
  const [expiryTime, setExpiryTime] = useState<Date | null>(null)
  const [isDarkMode, setIsDarkMode] = useState(true)
  const [progressMessage, setProgressMessage] = useState(`Initializing secure session for ${sessionId.slice(-8)}...`)
  const [progressValue, setProgressValue] = useState(0)
  const [showScreenshotShield, setShowScreenshotShield] = useState(false)
  const [passwordRequired, setPasswordRequired] = useState(false)
  const [passwordError, setPasswordError] = useState('')
  const [passwordValue, setPasswordValue] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [timeRemaining, setTimeRemaining] = useState('')
  const eventSourceRef = useRef<EventSource | null>(null)
  const passwordCallbackRef = useRef<((password: string) => void) | null>(null)

  const loadDocument = useCallback(async () => {
    try {
      // Start document loading from the current progress and only move forward
      setProgressValue(prev => Math.max(prev, 80))
      const tokenData = await getViewerToken(sessionId)
      
      if (tokenData.expiresAt) {
        // Persist the earliest known expiry for this session so refreshes
        // cannot extend the viewing window.
        try {
          const storageKey = `krnl_viewer_expiry_${sessionId}`
          const backendExpiryMs = new Date(tokenData.expiresAt).getTime()
          const storedRaw = localStorage.getItem(storageKey)
          const storedMs = storedRaw ? new Date(storedRaw).getTime() : NaN

          const hasStored = !Number.isNaN(storedMs)
          const effectiveExpiryMs = hasStored
            ? Math.min(backendExpiryMs, storedMs)
            : backendExpiryMs

          const effectiveExpiry = new Date(effectiveExpiryMs)
          setExpiryTime(effectiveExpiry)
          localStorage.setItem(storageKey, effectiveExpiry.toISOString())
        } catch {
          // Fallback if localStorage is unavailable
          setExpiryTime(new Date(tokenData.expiresAt))
        }
      }

      setProgressValue(prev => Math.max(prev, 85))
      const pdfBlob = await fetchDocument(tokenData.token)
      const arrayBuffer = await pdfBlob.arrayBuffer()
      
      setProgressValue(prev => Math.max(prev, 90))
      const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer })
      
      // Handle password-protected PDFs
      loadingTask.onPassword = (callback: (password: string) => void, reason: number) => {
        passwordCallbackRef.current = callback
        setPasswordRequired(true)
        
        if (reason === 1) {
          setPasswordError('Incorrect password. Please try again.')
        } else {
          setPasswordError('')
        }
      }
      
      setProgressValue(prev => Math.max(prev, 95))
      const pdf = await loadingTask.promise
      
      setProgressValue(prev => Math.max(prev, 100))
      setPdfDocument(pdf)
      setLoading(false)
    } catch (err) {
      console.error('Document load error:', err)
      setError(err instanceof Error ? err.message : 'Failed to load document')
      setLoading(false)
    }
  }, [sessionId])

  // Security: Disable context menu
  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => e.preventDefault()
    window.addEventListener('contextmenu', handleContextMenu, true)
    return () => window.removeEventListener('contextmenu', handleContextMenu, true)
  }, [])

  // Security: Disable keyboard shortcuts and detect screenshots
  useEffect(() => {
    const handleKeyboard = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target && (target.id === 'passwordInput' || target.closest('[role="dialog"]'))) {
        return
      }

      // Detect Screenshot Shortcuts & Common Save/Print combinations
      // Mac: Cmd+Shift+3/4/5
      // Windows: PrintScreen, Win+Shift+S
      if (
        (e.metaKey && e.shiftKey) || // Mac Screenshot combos
        (e.altKey && e.shiftKey) ||  // Alternative combos
        e.key === 'PrintScreen' ||   // Windows PrintScreen
        (e.metaKey && e.key === 'p') || // Print
        (e.ctrlKey && e.key === 'p') || // Print
        (e.metaKey && e.key === 's') || // Save
        (e.ctrlKey && e.key === 's')    // Save
      ) {
        setShowScreenshotShield(true)
      }

      e.preventDefault()
      e.stopPropagation()
    }
    
    ['keydown', 'keypress', 'keyup'].forEach(type => {
      window.addEventListener(type, handleKeyboard as EventListener, true)
    })
    
    return () => {
      ['keydown', 'keypress', 'keyup'].forEach(type => {
        window.removeEventListener(type, handleKeyboard as EventListener, true)
      })
    }
  }, [])

  // Security: Screenshot shield
  useEffect(() => {
    const handleBlur = () => setShowScreenshotShield(true)
    const handleFocus = () => setShowScreenshotShield(false)
    const handleVisibilityChange = () => {
      setShowScreenshotShield(document.visibilityState === 'hidden')
    }

    window.addEventListener('blur', handleBlur)
    window.addEventListener('focus', handleFocus)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      window.removeEventListener('blur', handleBlur)
      window.removeEventListener('focus', handleFocus)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [])

  // Token expiry timer
  useEffect(() => {
    if (!expiryTime) return

    const updateTimer = () => {
      const now = Date.now()
      const remaining = expiryTime.getTime() - now
      
      if (remaining <= 0) {
        setTimeRemaining('Expired')
        setError('This viewer link has expired. Please request a new one.')
        
        // Clear any persisted expiry for this session so a new session
        // can start cleanly next time.
        try {
          const storageKey = `krnl_viewer_expiry_${sessionId}`
          localStorage.removeItem(storageKey)
        } catch {
          return
        }
        
        return
      }

      const totalSeconds = Math.floor(remaining / 1000)
      const minutes = Math.floor(totalSeconds / 60)
      const seconds = totalSeconds % 60
      setTimeRemaining(`${minutes}:${seconds.toString().padStart(2, '0')}`)
    }

    updateTimer()
    const interval = setInterval(updateTimer, 1000)
    return () => clearInterval(interval)
  }, [expiryTime, sessionId])

  // Password submission handler
  const handlePasswordSubmit = () => {
    if (!passwordValue) {
      setPasswordError('Password is required')
      return
    }
    
    if (passwordCallbackRef.current) {
      passwordCallbackRef.current(passwordValue)
      setPasswordValue('')
      setPasswordRequired(false)
      setPasswordError('')
    }
  }

  // SSE for real-time progress
  useEffect(() => {
    const API_BASE_URL = import.meta.env.VITE_API_URL || window.location.origin
    const eventSource = new EventSource(`${API_BASE_URL}/api/access/stream/${sessionId}`)
    eventSourceRef.current = eventSource
    
    let isCompleted = false

    eventSource.onopen = () => {
      console.log('SSE connection opened')
      setProgressMessage(`Verifying session ${sessionId.slice(-8)} on KRNL network...`)
      setProgressValue(prev => Math.max(prev, 20))
    }

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        
        if (data.type === 'connected') {
          setProgressMessage('Connection Established')
          setProgressValue(prev => Math.max(prev, 10))
        } else if (data.type === 'progress') {
          
          // Calculate progress based on completed workflow steps
          // User requested ~20% per step
          if (data.steps && Array.isArray(data.steps)) {
            const completedSteps = data.steps.length
            const lastStep = data.steps[completedSteps - 1]
            
            // Map steps to progress
            // 1. prepare-access-log -> 30%
            // 2. prepare-authdata -> 50%
            // 3. target-calldata -> 70%
            // 4. sca-calldata -> 85%
            // 5. bundle -> 90% (Waiting for event)
            
            let newProgress = 10 + (completedSteps * 18) // Approx 18-20% per step
            
            if (lastStep) {
              if (lastStep.name === 'bundle') {
                newProgress = 90
                setProgressMessage('Generating access hash & watermarking document...')
              } else {
                setProgressMessage(`Executing: ${lastStep.name.replace(/-/g, ' ')}...`)
              }
            }
            
            setProgressValue(prev => Math.max(prev, Math.min(newProgress, 90)))
          } else if (data.state === 'RUNNING') {
            setProgressMessage('Processing access request on-chain...')
            setProgressValue(prev => Math.max(prev, 30))
          }
        } else if (data.type === 'complete') {
          isCompleted = true
          
          if (data.state === 'COMPLETED_WITH_EVENT' && data.accessHash) {
            setProgressMessage(`Access verified. Applying watermark: ${data.accessHash.slice(0, 10)}...`)
            setProgressValue(100)
            
            // Small delay to show 100% before loading
            setTimeout(() => {
              eventSource.close()
              loadDocument()
            }, 500)
          } else if (data.state === 'FAILED') {
            setError(data.error || 'Access verification failed')
            setLoading(false)
            eventSource.close()
          } else {
            setError('Access workflow completed without confirmation')
            setLoading(false)
            eventSource.close()
          }
        } else if (data.type === 'error') {
          setError(data.error || 'Verification failed')
          setLoading(false)
          eventSource.close()
        }
      } catch (err) {
        console.error('Failed to parse SSE event:', err)
      }
    }

    eventSource.onerror = () => {
      if (!isCompleted) {
        setError('Connection lost. Retrying...')
        setLoading(false)
      }
      eventSource.close()
    }

    return () => {
      if (eventSource.readyState !== EventSource.CLOSED) {
        eventSource.close()
      }
    }
  }, [sessionId, loadDocument])

  // Theme toggle
  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
  }, [isDarkMode])

  return (
    <div className="relative w-full h-full flex flex-col bg-background text-foreground overflow-hidden">
      {/* Header Bar - Glassmorphism */}
      <div className="absolute top-0 left-0 right-0 z-10 px-6 py-4 flex items-center justify-between bg-background/80 backdrop-blur-md border-b border-border/50 transition-all duration-300">
        <div className="flex items-center gap-4">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-primary/10 text-primary shadow-sm">
            <FileKey2 className="w-5 h-5" />
          </div>
          <div>
            <h1 className="font-semibold text-sm tracking-wide uppercase text-muted-foreground">Secure Viewer</h1>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          {timeRemaining && (
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium border ${
              timeRemaining === 'Expired' 
                ? 'bg-destructive/10 text-destructive border-destructive/20' 
                : 'bg-secondary text-secondary-foreground border-border'
            }`}>
              <Clock className="w-4 h-4" />
              <span className="font-mono tabular-nums">{timeRemaining}</span>
            </div>
          )}
          
          <div className="bg-secondary rounded-full p-1 border border-border">
            <div 
              className={`relative flex items-center w-14 h-7 rounded-full cursor-pointer transition-colors duration-300 ${isDarkMode ? 'bg-slate-800' : 'bg-sky-200'}`}
              onClick={() => setIsDarkMode(!isDarkMode)}
            >
              <div 
                className={`absolute w-5 h-5 rounded-full shadow-sm transform transition-transform duration-300 flex items-center justify-center ${
                  isDarkMode 
                    ? 'translate-x-8 bg-slate-900 text-slate-200' 
                    : 'translate-x-1 bg-white text-yellow-500'
                }`}
              >
                {isDarkMode ? <Moon className="w-3 h-3" /> : <Sun className="w-3 h-3" />}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 relative w-full h-full overflow-y-auto overflow-x-hidden bg-dot-pattern scroll-smooth">
        {/* Background Pattern - fixed to viewport */}
        <div className="fixed inset-0 bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] [background-size:16px_16px] opacity-[0.05] pointer-events-none" />

        <div className={`min-h-full w-full flex flex-col items-center px-4 ${loading ? 'justify-center' : 'pt-24 pb-32'}`}>
          {loading && (
            <div className="w-full max-w-md p-8 rounded-2xl border border-border bg-card/50 backdrop-blur-sm shadow-2xl space-y-8 animate-in fade-in zoom-in duration-500">
              <div className="flex flex-col items-center text-center space-y-4">
                <div className="relative">
                  <div className="absolute inset-0 bg-primary/20 blur-xl rounded-full animate-pulse" />
                  <Shield className="relative w-16 h-16 text-primary animate-bounce-subtle" />
                </div>
                <h2 className="text-2xl font-bold tracking-tight">Verifying Access</h2>
                <p className="text-muted-foreground text-sm">{progressMessage}</p>
              </div>
              
              <div className="space-y-2">
                <Progress value={progressValue} className="h-2" />
                <div className="flex justify-between text-xs text-muted-foreground font-medium uppercase tracking-wider">
                  <span>KRNL</span>
                  <span>{progressValue}%</span>
                </div>
              </div>
            </div>
          )}
          
          {error && (
            <div className="w-full max-w-md animate-in fade-in zoom-in duration-300 mt-20">
              <ErrorMessage message={error} isDarkMode={isDarkMode} />
            </div>
          )}
          
          {pdfDocument && !loading && !error && (
            <div className="relative w-full max-w-5xl flex flex-col items-center animate-in fade-in slide-in-from-bottom-4 duration-700">
              <PDFCanvas pdfDocument={pdfDocument} isDarkMode={isDarkMode} />
            </div>
          )}
        </div>
      </div>

      {/* Footer Status Bar - Glassmorphism (Matching Header) */}
      <div className="absolute bottom-0 left-0 right-0 z-10 px-6 py-3 flex items-center justify-between bg-background/80 backdrop-blur-md border-t border-border/50 transition-all duration-300">
        <div className="flex items-center gap-4 text-xs font-medium text-muted-foreground">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            <span>Secure Connection</span>
          </div>
          <span className="w-px h-3 bg-border" />
          <div className="flex items-center gap-2">
            <Shield className="w-3 h-3" />
            <span>Blockchain Verified</span>
          </div>
        </div>

        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-[10px] font-semibold tracking-widest text-muted-foreground/50 uppercase">
          Powered by KRNL Protocol
        </div>

        <div className="text-xs font-mono text-muted-foreground opacity-70">
          Session: {sessionId.slice(-8)}
        </div>
      </div>

      {/* Security Overlays */}
      
      {/* Screenshot Shield */}
      {showScreenshotShield && (
        <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center bg-background/95 backdrop-blur-xl animate-in fade-in duration-200">
          <div className="p-8 rounded-3xl bg-card/50 border border-border shadow-2xl text-center space-y-6 max-w-sm mx-auto">
            <div className="w-20 h-20 mx-auto rounded-full bg-destructive/10 flex items-center justify-center">
              <Lock className="w-10 h-10 text-destructive" />
            </div>
            <div>
              <h2 className="text-2xl font-bold mb-2">Protected Content</h2>
              <p className="text-muted-foreground text-sm leading-relaxed">
                This document is protected by KRNL security protocols. 
                Screen capture is disabled for this session.
              </p>
            </div>
            <Button 
              className="w-full" 
              variant="outline"
              onClick={() => setShowScreenshotShield(false)}
            >
              Click to Resume
            </Button>
          </div>
        </div>
      )}

      {/* Password Dialog */}
      <Dialog open={passwordRequired} onOpenChange={setPasswordRequired}>
        <DialogContent className="sm:max-w-md border-border/50 bg-background/95 backdrop-blur-xl shadow-2xl">
          <DialogHeader>
            <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4">
              <Lock className="w-6 h-6 text-primary" />
            </div>
            <DialogTitle className="text-xl">Password Required</DialogTitle>
            <DialogDescription className="text-base">
              This document is encrypted. Enter the password to decrypt and view.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            {passwordError && (
              <Alert variant="destructive" className="bg-destructive/10 border-destructive/20 text-destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{passwordError}</AlertDescription>
              </Alert>
            )}
            
            <div className="relative group">
              <Input
                id="passwordInput"
                type={showPassword ? 'text' : 'password'}
                value={passwordValue}
                onChange={(e) => setPasswordValue(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handlePasswordSubmit()}
                placeholder="Enter document password"
                className="pr-10 h-11 bg-secondary/50 border-border focus:bg-background transition-all"
                autoFocus
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-1 top-1 h-9 w-9 text-muted-foreground hover:text-foreground"
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
          </div>
          
          <DialogFooter>
            <Button onClick={handlePasswordSubmit} className="w-full h-11 text-base font-medium shadow-lg shadow-primary/20">
              Unlock Document
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
