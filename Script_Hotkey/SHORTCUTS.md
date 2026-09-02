# Shortcuts Addict — Shortcut Reference

## Main dual-monitor shortcut

| Shortcut | Action |
|---|---|
| `²` | Swaps the top visible window between the two monitors, maximizes both windows, and focuses the window moved to the primary monitor. |
| `²` twice quickly | Toggles automatic video handling ON/OFF without swapping windows. A French voice says **“Activé”** or **“Désactivé”**. |

### Automatic video handling

When enabled:

- If the window leaving the **primary monitor** has a playing media/video session, it is paused before the swap.
- If the window arriving on the **primary monitor** has a paused media/video session, playback is started after the swap.
- The window arriving on the primary monitor receives keyboard focus.

When disabled:

- Window swapping still works normally.
- The script does not pause or resume any media.

---

## Caps Lock Super Key

`Caps Lock` is completely disabled as a normal uppercase-lock key.

Hold `Caps Lock` and press another key to trigger an action. Pressing `Caps Lock` by itself does nothing.

| Shortcut | Action |
|---|---|
| `Caps + E` | Open File Explorer |
| `Caps + C` | Open Calculator |
| `Caps + T` | Open Windows Terminal. Falls back to PowerShell if Terminal is unavailable. |
| `Caps + V` | Open Windows Clipboard History (`Win + V`) |
| `Caps + Space` | Play / Pause media |
| `Caps + ↑` | Volume Up |
| `Caps + ↓` | Volume Down |
| `Caps + ←` | Previous Track |
| `Caps + →` | Next Track |
| `Caps + Mouse Wheel Up` | Volume Up |
| `Caps + Mouse Wheel Down` | Volume Down |
| `Caps + W` | Close the active window |
| `Caps + A` | Toggle Always On Top for the active window |
| `Caps + M` | Minimize the active window |
| `Caps + Enter` | Maximize / Restore the active window |

---

## Normal uppercase letters

Use `Shift` normally for uppercase letters.

The script forces the native Caps Lock state OFF and blocks the key from toggling uppercase mode. Caps Lock only acts as a physical modifier for the shortcuts above.

## Startup

The script can be placed directly in the Windows Startup folder:

1. Press `Win + R`
2. Enter `shell:startup`
3. Put the `.ahk` file in that folder

AutoHotkey v2 must be installed.
