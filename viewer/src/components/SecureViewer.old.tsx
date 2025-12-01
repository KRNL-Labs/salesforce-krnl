import { useEffect, useState, useCallback, useRef } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import { getViewerToken, fetchDocument } from '../api/client'
import LoadingState from './LoadingState'
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
  const [progressMessage, setProgressMessage] = useState('Connecting...')
  const [showScreenshotShield, setShowScreenshotShield] = useState(false)
  const [passwordRequired, setPasswordRequired] = useState(false)
  const [passwordError, setPasswordError] = useState('')
  const [passwordValue, setPasswordValue] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [timeRemaining, setTimeRemaining] = useState('')
  const [workflowState, setWorkflowState] = useState<string>('')
  const eventSourceRef = useRef<EventSource | null>(null)
  const passwordCallbackRef = useRef<((password: string) => void) | null>(null)

  const loadDocument = useCallback(async () => {
    try {
      // Get viewer token
      const tokenData = await getViewerToken(sessionId)
      
      if (tokenData.expiresAt) {
        setExpiryTime(new Date(tokenData.expiresAt))
      }

      // Fetch PDF document
      const pdfBlob = await fetchDocument(tokenData.token)
      const arrayBuffer = await pdfBlob.arrayBuffer()
      
      // Load PDF with PDF.js
      const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer })
      
      // Handle password-protected PDFs
      loadingTask.onPassword = (callback: (password: string) => void, reason: number) => {
        passwordCallbackRef.current = callback
        setPasswordRequired(true)
        
        if (reason === 1) { // INCORRECT_PASSWORD
          setPasswordError('Incorrect password. Please try again.')
        } else {
          setPasswordError('')
        }
      }
      
      const pdf = await loadingTask.promise
      
      setPdfDocument(pdf)
      setLoading(false)
    } catch (err) {
      console.error('Document load error:', err)
      setError(err instanceof Error ? err.message : 'Failed to load document')
      setLoading(false)
    }
  }, [sessionId])

  // Security: Disable context menu (right-click)
  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault()
    }
    window.addEventListener('contextmenu', handleContextMenu, true)
    return () => window.removeEventListener('contextmenu', handleContextMenu, true)
  }, [])

  // Security: Disable keyboard shortcuts (except in password input)
  useEffect(() => {
    const handleKeyboard = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target && (target.id === 'passwordInput' || target.closest('#passwordOverlay'))) {
        return // Allow typing in password input
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

  // Security: Screenshot shield (show overlay when window loses focus)
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
  }, [expiryTime])

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

  // Connect to SSE endpoint for real-time progress updates
  useEffect(() => {
    const API_BASE_URL = import.meta.env.VITE_API_URL || window.location.origin
    const eventSource = new EventSource(`${API_BASE_URL}/api/access/stream/${sessionId}`)
    eventSourceRef.current = eventSource
    
    let isCompleted = false

    eventSource.onopen = () => {
      console.log('SSE connection opened')
      setProgressMessage('Verifying access on blockchain...')
    }

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        console.log('SSE event:', data)

        if (data.type === 'connected') {
          setProgressMessage('Connected. Waiting for blockchain verification...')
          setWorkflowState('CONNECTED')
        } else if (data.type === 'progress') {
          setWorkflowState(data.state)
          // Update progress message based on state
          if (data.state === 'RUNNING') {
            setProgressMessage('Processing access request...')
          } else if (data.state === 'COMPLETED') {
            setProgressMessage('Waiting for blockchain confirmation...')
          }
        } else if (data.type === 'complete') {
          console.log('Workflow complete, loading document', data)
          isCompleted = true
          
          if (data.state === 'COMPLETED_WITH_EVENT' && data.accessHash) {
            setProgressMessage('Blockchain confirmed! Loading document...')
            eventSource.close()
            loadDocument()
          } else if (data.state === 'FAILED') {
            setError(data.error || 'Access verification failed')
            setLoading(false)
            eventSource.close()
          } else {
            setError('Access workflow completed without blockchain confirmation')
            setLoading(false)
            eventSource.close()
          }
        } else if (data.type === 'error') {
          setError(data.error || 'Failed to verify access')
          setLoading(false)
          eventSource.close()
        }
      } catch (err) {
        console.error('Failed to parse SSE event:', err)
      }
    }

    eventSource.onerror = (err) => {
      console.error('SSE connection error:', err)
      
      // Only show error if we haven't already completed
      if (!isCompleted) {
        setError('Lost connection to server. Please refresh the page.')
        setLoading(false)
      }
      
      eventSource.close()
    }

    return () => {
      console.log('Cleaning up SSE connection')
      if (eventSource.readyState !== EventSource.CLOSED) {
        eventSource.close()
      }
    }
  }, [sessionId, loadDocument])

  const toggleTheme = () => {
    setIsDarkMode(!isDarkMode)
  }

  return (
    <div className={`w-full h-full flex flex-col ${isDarkMode ? 'bg-gray-900' : 'bg-gray-100'}`}>
      {/* Screenshot Shield Overlay */}
      {showScreenshotShield && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900">
          <div className="text-center">
            <div className="text-6xl mb-4">🔒</div>
            <div className="text-2xl font-bold text-white mb-2">Secure Document Protected</div>
            <div className="text-gray-400">Click here to continue viewing</div>
          </div>
        </div>
      )}

      {/* Password Dialog Overlay */}
      {passwordRequired && (
        <div 
          id="passwordOverlay" 
          className="fixed inset-0 z-40 flex items-center justify-center bg-black bg-opacity-75"
        >
          <div className={`p-8 rounded-lg shadow-2xl max-w-md w-full ${isDarkMode ? 'bg-gray-800' : 'bg-white'}`}>
            <h2 className={`text-2xl font-bold mb-4 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
              🔐 Password Required
            </h2>
            <p className={`mb-6 ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
              This document is password protected. Please enter the password to view it.
            </p>
            
            {passwordError && (
              <div className="mb-4 p-3 bg-red-500 bg-opacity-20 border border-red-500 rounded text-red-400">
                {passwordError}
              </div>
            )}
            
            <div className="relative mb-6">
              <input
                id="passwordInput"
                type={showPassword ? 'text' : 'password'}
                value={passwordValue}
                onChange={(e) => setPasswordValue(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handlePasswordSubmit()}
                className={`w-full px-4 py-3 pr-20 rounded-lg border ${
                  isDarkMode 
                    ? 'bg-gray-700 border-gray-600 text-white' 
                    : 'bg-gray-100 border-gray-300 text-gray-900'
                } focus:outline-none focus:ring-2 focus:ring-blue-500`}
                placeholder="Enter password"
                autoFocus
              />
              <button
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-blue-500 hover:text-blue-600"
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
            
            <button
              onClick={handlePasswordSubmit}
              className="w-full px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-colors"
            >
              Unlock Document
            </button>
          </div>
        </div>
      )}

      {/* Enhanced Toolbar */}
      <div className={`flex items-center justify-between px-6 py-4 border-b ${
        isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'
      }`}>
        <div className="flex items-center space-x-4">
          <div className="text-2xl">📄</div>
          <div>
            <div className={`font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
              Secure Document Viewer
            </div>
            {workflowState && (
              <div className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                Status: {workflowState}
              </div>
            )}
          </div>
        </div>
        
        <div className="flex items-center space-x-4">
          {timeRemaining && (
            <div className={`flex items-center space-x-2 px-3 py-1 rounded-full ${
              timeRemaining === 'Expired' 
                ? 'bg-red-500 bg-opacity-20 text-red-400' 
                : 'bg-blue-500 bg-opacity-20 text-blue-400'
            }`}>
              <span>⏱️</span>
              <span className="font-mono text-sm">{timeRemaining}</span>
            </div>
          )}
          
          <button
            onClick={toggleTheme}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              isDarkMode 
                ? 'bg-gray-700 hover:bg-gray-600 text-white' 
                : 'bg-gray-200 hover:bg-gray-300 text-gray-900'
            }`}
          >
            {isDarkMode ? '☀️ Light' : '🌙 Dark'}
          </button>
        </div>
      </div>
      
      {/* Main Content Area */}
      <div className="flex-1 overflow-auto">
        {loading && (
          <LoadingState 
            message={progressMessage}
            isDarkMode={isDarkMode}
          />
        )}
        
        {error && <ErrorMessage message={error} isDarkMode={isDarkMode} />}
        
        {pdfDocument && !loading && !error && (
          <PDFCanvas pdfDocument={pdfDocument} isDarkMode={isDarkMode} />
        )}
      </div>
      
      {/* Security Watermark Footer */}
      <div className={`px-6 py-2 text-center text-xs border-t ${
        isDarkMode 
          ? 'bg-gray-800 border-gray-700 text-gray-500' 
          : 'bg-gray-50 border-gray-200 text-gray-600'
      }`}>
        🔒 This document is securely watermarked and access is logged on blockchain • Session: {sessionId.slice(-8)}
      </div>
    </div>
  )
}
