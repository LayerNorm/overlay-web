import { describe, expect, it } from 'vitest'
import { darkTheme, lightTheme } from '../../utils/theme'
import { resolveSidebarListItemColors } from './SidebarListItem.styles'

describe('resolveSidebarListItemColors', () => {
  it('uses the semantic gray selection surface and light foreground in dark mode', () => {
    const colors = resolveSidebarListItemColors({
      theme: darkTheme,
      isActive: true,
      isBatchSelected: false,
      isSelectMode: false,
      isHovered: false
    })

    expect(darkTheme.isDark).toBe(true)
    expect(colors.background).toBe(darkTheme.selectionBg)
    expect(colors.background).not.toBe(darkTheme.buttonBg)
    expect(colors.foreground).toBe(darkTheme.selectionText)
  })

  it('uses the same semantic selection contract in light mode and batch selection', () => {
    const colors = resolveSidebarListItemColors({
      theme: lightTheme,
      isActive: false,
      isBatchSelected: true,
      isSelectMode: true,
      isHovered: false
    })

    expect(lightTheme.isDark).toBe(false)
    expect(colors.background).toBe(lightTheme.selectionBg)
    expect(colors.foreground).toBe(lightTheme.selectionText)
  })
})
