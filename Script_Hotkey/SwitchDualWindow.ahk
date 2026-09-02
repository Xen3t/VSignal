#Requires AutoHotkey v2.0

SC029::
{
    if MonitorGetCount() < 2 {
        MsgBox "Il faut au moins 2 écrans."
        return
    }

    win1 := GetTopWindowOnMonitor(1)
    win2 := GetTopWindowOnMonitor(2)

    if !win1 || !win2 {
        MsgBox "Impossible de trouver une fenêtre visible sur chaque écran."
        return
    }

    if win1 = win2
        return

    ; Récupère les zones utilisables de chaque écran
    MonitorGetWorkArea(1, &l1, &t1, &r1, &b1)
    MonitorGetWorkArea(2, &l2, &t2, &r2, &b2)

    ; Sort les fenêtres de l'état maximisé
    WinRestore("ahk_id " win1)
    WinRestore("ahk_id " win2)

    ; Déplace la fenêtre de l'écran 1 vers l'écran 2
    WinMove(
        l2,
        t2,
        r2 - l2,
        b2 - t2,
        "ahk_id " win1
    )

    ; Déplace la fenêtre de l'écran 2 vers l'écran 1
    WinMove(
        l1,
        t1,
        r1 - l1,
        b1 - t1,
        "ahk_id " win2
    )

    ; Maximisation native Windows
    WinMaximize("ahk_id " win1)
    WinMaximize("ahk_id " win2)

    ; Donne le focus à la fenêtre qui arrive
    ; sur l'écran principal Windows
    primary := MonitorGetPrimary()

    if primary = 1
        WinActivate("ahk_id " win2)
    else if primary = 2
        WinActivate("ahk_id " win1)
}


GetTopWindowOnMonitor(mon)
{
    windows := WinGetList()

    for hwnd in windows {

        ; Ignore les fenêtres minimisées
        try {
            if WinGetMinMax("ahk_id " hwnd) = -1
                continue
        } catch {
            continue
        }

        ; Ignore le bureau et les barres des tâches
        try {
            class := WinGetClass("ahk_id " hwnd)
        } catch {
            continue
        }

        if class = "Progman"
        || class = "WorkerW"
        || class = "Shell_TrayWnd"
        || class = "Shell_SecondaryTrayWnd"
            continue

        ; Récupère position et taille
        try {
            WinGetPos(&x, &y, &w, &h, "ahk_id " hwnd)
        } catch {
            continue
        }

        ; Ignore les petites fenêtres système invisibles / parasites
        if w < 100 || h < 100
            continue

        ; Centre de la fenêtre
        cx := x + w / 2
        cy := y + h / 2

        ; Limites du moniteur
        MonitorGet(mon, &ml, &mt, &mr, &mb)

        ; Si le centre est sur cet écran, on la prend
        if cx >= ml
        && cx < mr
        && cy >= mt
        && cy < mb
            return hwnd
    }

    return 0
}