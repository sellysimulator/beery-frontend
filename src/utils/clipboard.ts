/**
 * Copies `text` to the clipboard, falling back to a hidden textarea. Resolves
 * to whether it worked; it never throws, so the caller just says so.
 *
 * The Clipboard API is tried whenever it exists and the textarea catches what
 * it refuses, rather than the other way round: `navigator.clipboard` is absent
 * or rejects outside a secure context, and a host running the game on a laptop
 * over plain HTTP on a classroom LAN is exactly that case.
 *
 * Shared by the host lobby's `InvitePanel` and the multi-game dashboard's
 * cards, which both copy an invite link.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Fall through to the textarea path below.
  }

  try {
    const field = document.createElement('textarea')
    field.value = text
    field.setAttribute('readonly', '')
    field.style.position = 'fixed'
    field.style.opacity = '0'
    document.body.appendChild(field)
    field.select()
    const copied = document.execCommand('copy')
    document.body.removeChild(field)
    return copied
  } catch {
    return false
  }
}
