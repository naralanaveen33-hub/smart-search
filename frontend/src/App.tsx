import { useCallback, useEffect, useState } from 'react'
import { Route, Routes } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { PresentationMode } from '@/components/presentation/PresentationMode'
import { WelcomeDialog } from '@/components/WelcomeDialog'
import { IndexingProvider } from '@/hooks/useIndexing'
import { SearchProvider } from '@/hooks/useSearch'
import { ThemeProvider } from '@/hooks/useTheme'
import { AnalyticsPage } from '@/pages/AnalyticsPage'
import { DocumentsPage } from '@/pages/DocumentsPage'
import { HomePage } from '@/pages/HomePage'
import { HowItWorksPage } from '@/pages/HowItWorksPage'
import { IndexExplorerPage } from '@/pages/IndexExplorerPage'
import { IndexingPage } from '@/pages/IndexingPage'
import { NotFoundPage } from '@/pages/NotFoundPage'
import { ResultsPage } from '@/pages/ResultsPage'
import { SearchPage } from '@/pages/SearchPage'
import { SettingsPage } from '@/pages/SettingsPage'

export default function App() {
  const [presenting, setPresenting] = useState(false)
  const present = useCallback(() => setPresenting(true), [])

  // Global shortcut: P starts the presentation, Escape leaves it.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const typing =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      if (typing || event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key === 'p' || event.key === 'P') {
        event.preventDefault()
        setPresenting(true)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <ThemeProvider>
      <IndexingProvider>
        <SearchProvider>
          <AppShell onPresent={present}>
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/how-it-works" element={<HowItWorksPage />} />
              <Route path="/documents" element={<DocumentsPage />} />
              <Route path="/indexing" element={<IndexingPage />} />
              <Route path="/search" element={<SearchPage />} />
              <Route path="/results" element={<ResultsPage />} />
              <Route path="/index-explorer" element={<IndexExplorerPage />} />
              <Route path="/analytics" element={<AnalyticsPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </AppShell>
          <WelcomeDialog />
          {presenting && <PresentationMode onExit={() => setPresenting(false)} />}
        </SearchProvider>
      </IndexingProvider>
    </ThemeProvider>
  )
}
