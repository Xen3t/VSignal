#Requires AutoHotkey v2.0
#SingleInstance Force

#Include Media.ahk


; ============================================================
;  TOUCHE ² = SWAP DES DEUX ÉCRANS
;
;  - Pause la vidéo qui quitte l'écran principal
;  - Inverse les fenêtres
;  - Maximise les deux
;  - Lance la vidéo qui arrive sur l'écran principal
;  - Donne le focus à cette fenêtre
; ============================================================

SC029::
{
    monitorCount := MonitorGetCount()

    if monitorCount < 2 {
        MsgBox "Il faut au moins 2 écrans."
        return
    }

    ; --------------------------------------------------------
    ; Détermine écran principal + autre écran
    ; --------------------------------------------------------

    primary := MonitorGetPrimary()
    secondary := 0

    Loop monitorCount {
        if A_Index != primary {
            secondary := A_Index
            break
        }
    }

    if !secondary
        return


    ; --------------------------------------------------------
    ; Trouve la fenêtre visible principale de chaque écran
    ; --------------------------------------------------------

    winPrimary := GetTopWindowOnMonitor(primary)
    winSecondary := GetTopWindowOnMonitor(secondary)

    if !winPrimary || !winSecondary {
        MsgBox "Impossible de trouver une fenêtre sur chaque écran."
        return
    }

    if winPrimary = winSecondary
        return


    ; --------------------------------------------------------
    ; MÉDIA AVANT LE SWAP
    ; --------------------------------------------------------

    ; Fenêtre qui QUITTE l'écran principal
    outgoingMedia := GetMediaSessionForWindow(winPrimary)

    ; Fenêtre qui VA ARRIVER sur l'écran principal
    incomingMedia := GetMediaSessionForWindow(winSecondary)


    ; Si la fenêtre principale joue actuellement quelque chose :
    ; PAUSE
    if IsObject(outgoingMedia) {
        try {
            if outgoingMedia.PlaybackStatus = 4
                outgoingMedia.Pause()
        }
    }


    ; --------------------------------------------------------
    ; Zones disponibles des écrans
    ; --------------------------------------------------------

    MonitorGetWorkArea(
        primary,
        &pLeft,
        &pTop,
        &pRight,
        &pBottom
    )

    MonitorGetWorkArea(
        secondary,
        &sLeft,
        &sTop,
        &sRight,
        &sBottom
    )


    ; --------------------------------------------------------
    ; Restaure avant déplacement
    ; --------------------------------------------------------

    try WinRestore("ahk_id " winPrimary)
    try WinRestore("ahk_id " winSecondary)


    ; --------------------------------------------------------
    ; SWAP
    ; --------------------------------------------------------

    ; Fenêtre principale -> écran secondaire
    WinMove(
        sLeft,
        sTop,
        sRight - sLeft,
        sBottom - sTop,
        "ahk_id " winPrimary
    )

    ; Fenêtre secondaire -> écran principal
    WinMove(
        pLeft,
        pTop,
        pRight - pLeft,
        pBottom - pTop,
        "ahk_id " winSecondary
    )


    ; --------------------------------------------------------
    ; Maximisation
    ; --------------------------------------------------------

    WinMaximize("ahk_id " winPrimary)
    WinMaximize("ahk_id " winSecondary)


    ; --------------------------------------------------------
    ; Focus sur celle qui vient d'arriver sur l'écran principal
    ; --------------------------------------------------------

    WinActivate("ahk_id " winSecondary)


    ; --------------------------------------------------------
    ; MÉDIA APRÈS LE SWAP
    ; --------------------------------------------------------

    ; Si la fenêtre qui vient d'arriver possède une session média
    ; en pause, on lance la lecture.
    if IsObject(incomingMedia) {
        try {
            status := incomingMedia.PlaybackStatus

            ; 5 = Paused
            if status = 5
                incomingMedia.Play()
        }
    }
}



; ============================================================
; Trouve la fenêtre au-dessus des autres sur un écran
; ============================================================

GetTopWindowOnMonitor(mon)
{
    MonitorGet(mon, &ml, &mt, &mr, &mb)

    windows := WinGetList()

    for hwnd in windows {

        ; Fenêtre réellement visible
        if !DllCall("IsWindowVisible", "ptr", hwnd)
            continue

        ; Ignore les fenêtres minimisées
        try {
            if WinGetMinMax("ahk_id " hwnd) = -1
                continue
        } catch {
            continue
        }

        ; Classe de fenêtre
        try {
            class := WinGetClass("ahk_id " hwnd)
        } catch {
            continue
        }

        ; Ignore bureau / taskbar / shell
        if class = "Progman"
        || class = "WorkerW"
        || class = "Shell_TrayWnd"
        || class = "Shell_SecondaryTrayWnd"
            continue

        ; Position
        try {
            WinGetPos(&x, &y, &w, &h, "ahk_id " hwnd)
        } catch {
            continue
        }

        ; Ignore les petites fenêtres système parasites
        if w < 100 || h < 100
            continue

        ; Centre de la fenêtre
        cx := x + (w / 2)
        cy := y + (h / 2)

        ; Le centre appartient à cet écran
        if cx >= ml
        && cx < mr
        && cy >= mt
        && cy < mb
            return hwnd
    }

    return 0
}



; ============================================================
; Trouve la session média correspondant à une fenêtre
; ============================================================

GetMediaSessionForWindow(hwnd)
{
    try processName := WinGetProcessName("ahk_id " hwnd)
    catch
        return 0

    processName := NormalizeAppName(processName)

    ; On évite les applis principalement audio
    if IsAudioOnlyApp(processName)
        return 0

    try sessions := Media.GetSessions()
    catch
        return 0

    ; --------------------------------------------------------
    ; Recherche normale :
    ; Edge -> MSEdge
    ; Chrome -> Chrome
    ; VLC -> VLC
    ; etc.
    ; --------------------------------------------------------

    for session in sessions {

        try source := session.SourceAppUserModelId
        catch
            continue

        source := NormalizeAppName(source)

        if AppsMatch(processName, source)
            return session
    }


    ; --------------------------------------------------------
    ; Firefox est parfois un petit être spécial et renvoie
    ; un identifiant hashé au lieu de "Firefox".
    ;
    ; Si Firefox est la fenêtre ET qu'il n'existe qu'une seule
    ; session média Windows, on considère qu'elle lui appartient.
    ; --------------------------------------------------------

    if processName = "firefox" && sessions.Length = 1
        return sessions[1]


    return 0
}



; ============================================================
; Compare application Windows <-> session média
; ============================================================

AppsMatch(processName, source)
{
    if processName = source
        return true

    if InStr(source, processName)
        return true

    if InStr(processName, source)
        return true

    ; Alias navigateurs
    if processName = "msedge" && source = "edge"
        return true

    if processName = "chrome" && source = "googlechrome"
        return true

    if processName = "brave" && InStr(source, "brave")
        return true

    if processName = "opera" && InStr(source, "opera")
        return true

    return false
}



; ============================================================
; Normalisation noms d'applications
; ============================================================

NormalizeAppName(name)
{
    name := StrLower(name)

    name := StrReplace(name, ".exe", "")
    name := RegExReplace(name, "[^a-z0-9]", "")

    ; Quelques noms Windows parfois différents
    if InStr(name, "microsoftedge")
        return "msedge"

    if InStr(name, "googlechrome")
        return "chrome"

    return name
}



; ============================================================
; Apps audio qu'on ne veut PAS lancer automatiquement
; ============================================================

IsAudioOnlyApp(name)
{
    audioApps := [
        "spotify",
        "deezer",
        "tidal",
        "itunes",
        "musicbee",
        "foobar2000",
        "winamp"
    ]

    for app in audioApps {
        if InStr(name, app)
            return true
    }

    return false
}