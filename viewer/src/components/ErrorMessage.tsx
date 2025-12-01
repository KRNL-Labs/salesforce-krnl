interface ErrorMessageProps {
  message: string
  isDarkMode: boolean
}

export default function ErrorMessage({ message, isDarkMode }: ErrorMessageProps) {
  return (
    <div className="flex items-center justify-center h-full">
      <div className={`max-w-md p-6 rounded-lg ${
        isDarkMode ? 'bg-red-900/20 border border-red-800' : 'bg-red-50 border border-red-200'
      }`}>
        <h2 className={`text-lg font-semibold mb-2 ${isDarkMode ? 'text-red-400' : 'text-red-700'}`}>
          Error
        </h2>
        <p className={isDarkMode ? 'text-red-300' : 'text-red-600'}>
          {message}
        </p>
      </div>
    </div>
  )
}
