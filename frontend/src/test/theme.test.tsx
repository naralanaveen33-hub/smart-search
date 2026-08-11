import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { ThemeToggle } from '@/components/layout/ThemeToggle'
import { ThemeProvider } from '@/hooks/useTheme'

describe('theme switching', () => {
  beforeEach(() => {
    window.localStorage.clear()
    document.documentElement.classList.remove('dark')
  })

  it('applies the dark class and persists the choice', async () => {
    const user = userEvent.setup()
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    )

    // matchMedia is stubbed to `matches: false`, so the default is dark.
    expect(document.documentElement.classList.contains('dark')).toBe(true)

    await user.click(screen.getByRole('button', { name: /switch to light mode/i }))
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(window.localStorage.getItem('swiftsearch-theme')).toBe('light')

    await user.click(screen.getByRole('button', { name: /switch to dark mode/i }))
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(window.localStorage.getItem('swiftsearch-theme')).toBe('dark')
  })

  it('restores the stored theme on mount', () => {
    window.localStorage.setItem('swiftsearch-theme', 'light')
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    )
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })
})
