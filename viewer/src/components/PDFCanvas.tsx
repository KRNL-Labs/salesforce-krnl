import { useEffect, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'

interface PDFCanvasProps {
  pdfDocument: pdfjsLib.PDFDocumentProxy
  isDarkMode: boolean
}

export default function PDFCanvas({ pdfDocument }: PDFCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [renderedPages, setRenderedPages] = useState<number>(0)

  useEffect(() => {
    const renderAllPages = async () => {
      if (!containerRef.current) return

      // Clear previous content
      containerRef.current.innerHTML = ''

      const numPages = pdfDocument.numPages

      for (let pageNum = 1; pageNum <= numPages; pageNum++) {
        try {
          const page = await pdfDocument.getPage(pageNum)
          const viewport = page.getViewport({ scale: 1.5 })

          // Create page container
          const pageContainer = document.createElement('div')
          pageContainer.className = 'relative group mx-auto mb-8 transition-transform hover:scale-[1.01] duration-300'
          pageContainer.style.width = `${viewport.width}px`
          
          // Add decorative top border (The "Blue Border" user requested)
          const topBorder = document.createElement('div')
          topBorder.className = 'absolute -top-[1px] left-0 right-0 h-1 bg-primary rounded-t-sm z-10'
          pageContainer.appendChild(topBorder)

          // Create canvas for this page
          const canvas = document.createElement('canvas')
          canvas.className = 'rounded-sm shadow-2xl bg-white'
          canvas.width = viewport.width
          canvas.height = viewport.height

          const context = canvas.getContext('2d')
          if (!context) continue

          // Render page
          await page.render({
            canvasContext: context,
            viewport: viewport
          }).promise

          pageContainer.appendChild(canvas)
          
          // Add page number badge
          const pageBadge = document.createElement('div')
          pageBadge.className = 'absolute -right-12 top-0 px-2 py-1 text-[10px] font-mono font-medium text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity'
          pageBadge.innerText = `Page ${pageNum}`
          pageContainer.appendChild(pageBadge)

          containerRef.current?.appendChild(pageContainer)
          setRenderedPages(pageNum)
        } catch (err) {
          console.error(`Error rendering page ${pageNum}:`, err)
        }
      }
    }

    renderAllPages()
  }, [pdfDocument])

  return (
    <div className="w-full flex flex-col items-center">
      <div ref={containerRef} className="w-full" />
      
      {renderedPages > 0 && (
        <div className="text-center mt-8 mb-12 text-xs font-medium text-muted-foreground uppercase tracking-widest opacity-60">
          — End of Document —
        </div>
      )}
    </div>
  )
}
