/**
 * `components/shared/Select.tsx` — the app's own dropdown, which replaced the
 * browser's native `<select>` so the popup is drawn in the theme rather than
 * in the operating system's chrome.
 *
 * It must keep what a native select gives for free: a combobox name, the
 * chosen value, keyboard operation, and options that cannot be chosen.
 */
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'

import Select, { type SelectOption } from '../components/shared/Select'

const OPTIONS: SelectOption[] = [
  { value: 'RETAILER', label: 'Retailer' },
  { value: 'WHOLESALER', label: 'Wholesaler', disabled: true, detail: 'Taken by Bea' },
  { value: 'DISTRIBUTOR', label: 'Distributor' },
  { value: 'FACTORY', label: 'Factory' },
]

function Harness({
  onChange,
  initial = null,
  disabled = false,
}: {
  onChange: (value: string) => void
  initial?: string | null
  disabled?: boolean
}) {
  const [value, setValue] = useState<string | null>(initial)
  return (
    <>
      <Select
        aria-label="Seat"
        value={value}
        options={OPTIONS}
        placeholder="Pick one"
        disabled={disabled}
        onChange={(next) => {
          setValue(next)
          onChange(next)
        }}
      />
      <button type="button">elsewhere</button>
    </>
  )
}

function combobox(): HTMLElement {
  return screen.getByRole('combobox', { name: 'Seat' })
}

describe('Select', () => {
  it('is a named combobox showing the placeholder, with its list closed', () => {
    render(<Harness onChange={() => {}} />)
    expect(combobox()).toHaveAttribute('aria-expanded', 'false')
    expect(combobox()).toHaveTextContent('Pick one')
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('opens on click and picks an option, showing it and reporting it once', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)

    await user.click(combobox())
    expect(combobox()).toHaveAttribute('aria-expanded', 'true')
    await user.click(screen.getByRole('option', { name: /distributor/i }))

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith('DISTRIBUTOR')
    expect(combobox()).toHaveTextContent('Distributor')
    expect(combobox()).toHaveAttribute('aria-expanded', 'false')
  })

  it('marks the chosen option as selected', async () => {
    const user = userEvent.setup()
    render(<Harness onChange={() => {}} initial="FACTORY" />)
    await user.click(combobox())
    expect(screen.getByRole('option', { name: /factory/i })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('option', { name: /retailer/i })).toHaveAttribute('aria-selected', 'false')
  })

  it('lists a disabled option with its reason, and a click on it chooses nothing', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    await user.click(combobox())

    const taken = screen.getByRole('option', { name: /wholesaler/i })
    expect(taken).toHaveAttribute('aria-disabled', 'true')
    expect(taken).toHaveTextContent('Taken by Bea')
    await user.click(taken)

    expect(onChange).not.toHaveBeenCalled()
  })

  it('works from the keyboard and skips a disabled option', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Harness onChange={onChange} initial="RETAILER" />)

    combobox().focus()
    await user.keyboard('{ArrowDown}') // opens on Retailer
    expect(combobox()).toHaveAttribute('aria-expanded', 'true')
    await user.keyboard('{ArrowDown}') // Wholesaler is disabled: lands on Distributor
    const active = combobox().getAttribute('aria-activedescendant')
    expect(active && document.getElementById(active)).toHaveTextContent('Distributor')
    await user.keyboard('{Enter}')

    expect(onChange).toHaveBeenCalledWith('DISTRIBUTOR')
  })

  it('jumps to an option by its first letter', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    combobox().focus()
    await user.keyboard('f')
    await user.keyboard('{Enter}')
    expect(onChange).toHaveBeenCalledWith('FACTORY')
  })

  it('closes without choosing on Escape and on a click elsewhere', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)

    await user.click(combobox())
    await user.keyboard('{Escape}')
    expect(combobox()).toHaveAttribute('aria-expanded', 'false')

    await user.click(combobox())
    await user.click(screen.getByRole('button', { name: 'elsewhere' }))
    expect(combobox()).toHaveAttribute('aria-expanded', 'false')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('does not open while disabled', async () => {
    const user = userEvent.setup()
    render(<Harness onChange={() => {}} disabled />)
    expect(combobox()).toBeDisabled()
    await user.click(combobox())
    expect(combobox()).toHaveAttribute('aria-expanded', 'false')
  })
})
