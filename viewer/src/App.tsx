import { useEffect, useState } from 'react'
import SecureViewer from './components/SecureViewer'

function App() {
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // Get sessionId from URL query params
    const params = new URLSearchParams(window.location.search)
    const sid = params.get('sessionId')
    
    if (!sid) {
      setError('No session ID provided. Please use a valid viewer link.')
      return
    }
    
    setSessionId(sid)
  }, [])

  if (error) {
    return (
      <div className="flex items-center justify-center w-full h-full bg-gray-900">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-red-400 mb-2">Error</h1>
          <p className="text-gray-300">{error}</p>
        </div>
      </div>
    )
  }

  if (!sessionId) {
    return (
      <div className="flex items-center justify-center w-full h-full bg-gray-900">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-gray-300">Loading...</p>
        </div>
      </div>
    )
  }

  return <SecureViewer sessionId={sessionId} />
}

export default App
