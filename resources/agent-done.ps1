[CmdletBinding(PositionalBinding = $false)]
param(
    [Parameter(Position = 0)]
    [ValidateSet('Claude', 'Codex')]
    [string]$Agent,

    [ValidateSet('Done', 'Question', 'Code', 'Tested', 'Blocked', 'Quota')]
    [string]$State = 'Done',

    [string]$Detail = '',

    [switch]$ReadStdin,

    [switch]$CacheClaudeQuota,

    [string]$QuotaText = '',

    [switch]$PrintQuota,

    [switch]$Display,

    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$HookPayload
)

$ErrorActionPreference = 'Stop'

if (-not $Display -and -not $CacheClaudeQuota -and -not $PrintQuota -and (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'disabled'))) {
    exit 0
}

function Get-PopupPreference {
    $defaults = [ordered]@{ ClaudeShort = $true; ClaudeWeekly = $true; CodexShort = $true; CodexWeekly = $true }
    $path = Join-Path $PSScriptRoot 'popup.json'
    if (-not (Test-Path -LiteralPath $path)) { return $defaults }

    try {
        $stored = Get-Content -Raw -LiteralPath $path | ConvertFrom-Json
        foreach ($key in @($defaults.Keys)) {
            if ($null -ne $stored.$key) { $defaults[$key] = [bool]$stored.$key }
        }
    } catch {}
    return $defaults
}

function Format-QuotaText {
    param(
        $Primary,
        $Secondary,
        [ValidateSet('', 'Claude', 'Codex')]
        [string]$ForAgent = '',
        [switch]$ApplyPreference
    )

    $preference = if ($ApplyPreference) { Get-PopupPreference } else { $null }

    $parts = @()
    $now = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    foreach ($limit in @($Primary, $Secondary)) {
        if ($null -eq $limit -or $null -eq $limit.usedPercent) { continue }

        $used = [Math]::Min(100, [Math]::Max(0, [Math]::Round([double]$limit.usedPercent)))
        $minutes = [int]$limit.windowDurationMins
        $window = if ($minutes -eq 300) {
            '5 h'
        } elseif ($minutes -eq 10080) {
            '7 j'
        } elseif ($minutes -ge 1440 -and $minutes % 1440 -eq 0) {
            '{0} j' -f ($minutes / 1440)
        } elseif ($minutes -ge 60 -and $minutes % 60 -eq 0) {
            '{0} h' -f ($minutes / 60)
        } else {
            '{0} min' -f $minutes
        }

        if ($null -ne $preference) {
            $field = '{0}{1}' -f $ForAgent, $(if ($minutes -ge 1440) { 'Weekly' } else { 'Short' })
            if (-not $preference[$field]) { continue }
        }

        $resetSuffix = ''
        if ($null -ne $limit.resetsAt -and [long]$limit.resetsAt -gt $now) {
            $seconds = [long]$limit.resetsAt - $now
            $days = [Math]::Floor($seconds / 86400)
            $hours = [Math]::Floor(($seconds % 86400) / 3600)
            $mins = [Math]::Floor(($seconds % 3600) / 60)
            $resetIn = if ($days -gt 0) {
                if ($hours -gt 0) { '{0} j {1} h' -f $days, $hours } else { '{0} j' -f $days }
            } elseif ($hours -gt 0) {
                if ($mins -gt 0) { '{0} h {1} min' -f $hours, $mins } else { '{0} h' -f $hours }
            } else {
                '{0} min' -f [Math]::Max(1, $mins)
            }
            $resetSuffix = ' reset {0}' -f $resetIn
        }

        $parts += '{0} {1} %{2}' -f $window, $used, $resetSuffix
    }

    if ($parts.Count -eq 0) { return '' }
    return 'Quota : ' + ($parts -join '  |  ')
}

function Wait-AppServerResponse {
    param(
        [System.Diagnostics.Process]$Process,
        [int]$Id,
        [int]$TimeoutMilliseconds
    )

    $watch = [System.Diagnostics.Stopwatch]::StartNew()
    while ($watch.ElapsedMilliseconds -lt $TimeoutMilliseconds) {
        $remaining = [Math]::Max(1, $TimeoutMilliseconds - [int]$watch.ElapsedMilliseconds)
        $readTask = $Process.StandardOutput.ReadLineAsync()
        if (-not $readTask.Wait($remaining)) { return $null }

        $line = $readTask.Result
        if ($null -eq $line) { return $null }
        try { $message = $line | ConvertFrom-Json } catch { continue }
        if ($message.id -eq $Id) { return $message }
    }
    return $null
}

function Get-CodexQuotaText {
    param([switch]$ApplyPreference)

    $codexCommand = Get-Command codex.exe -ErrorAction SilentlyContinue | Select-Object -First 1
    $codexPath = if ($codexCommand) { $codexCommand.Source } else { $null }

    if (-not $codexPath) {
        $codexPath = Get-ChildItem -Path (Join-Path $env:USERPROFILE '.vscode\extensions\openai.chatgpt-*\bin\windows-x86_64\codex.exe') -ErrorAction SilentlyContinue |
            Sort-Object LastWriteTime -Descending |
            Select-Object -First 1 -ExpandProperty FullName
    }
    if (-not $codexPath) { return '' }

    $process = $null
    try {
        $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
        $startInfo.FileName = $codexPath
        $startInfo.Arguments = 'app-server'
        $startInfo.UseShellExecute = $false
        $startInfo.CreateNoWindow = $true
        $startInfo.RedirectStandardInput = $true
        $startInfo.RedirectStandardOutput = $true
        $startInfo.RedirectStandardError = $true

        $process = [System.Diagnostics.Process]::new()
        $process.StartInfo = $startInfo
        $null = $process.Start()

        $process.StandardInput.WriteLine('{"method":"initialize","id":0,"params":{"clientInfo":{"name":"vsignal","title":"VSignal","version":"1.0.0"}}}')
        $process.StandardInput.Flush()
        $initialized = Wait-AppServerResponse -Process $process -Id 0 -TimeoutMilliseconds 3000
        if ($null -eq $initialized -or $initialized.error) { return '' }

        $process.StandardInput.WriteLine('{"method":"initialized","params":{}}')
        $process.StandardInput.WriteLine('{"method":"account/rateLimits/read","id":6}')
        $process.StandardInput.Flush()
        $response = Wait-AppServerResponse -Process $process -Id 6 -TimeoutMilliseconds 4000
        if ($null -eq $response -or $response.error -or $null -eq $response.result.rateLimits) { return '' }

        return Format-QuotaText -Primary $response.result.rateLimits.primary -Secondary $response.result.rateLimits.secondary -ForAgent 'Codex' -ApplyPreference:$ApplyPreference
    } catch {
        return ''
    } finally {
        if ($null -ne $process) {
            try { $process.StandardInput.Close() } catch {}
            try { if (-not $process.HasExited) { $process.Kill() } } catch {}
            $process.Dispose()
        }
    }
}

# Convertit une fenetre de ~/.claude.json en objet attendu par Format-QuotaText.
# Le champ 'utilization' y est un pourcentage consomme de 0 a 100.
function ConvertTo-QuotaWindow {
    param($Window, [int]$DurationMins)

    if ($null -eq $Window -or $null -eq $Window.utilization) { return $null }

    $resetsAt = $null
    if ($Window.resets_at) {
        try {
            $resetsAt = [DateTimeOffset]::Parse(
                [string]$Window.resets_at,
                [System.Globalization.CultureInfo]::InvariantCulture,
                [System.Globalization.DateTimeStyles]::RoundtripKind
            ).ToUnixTimeSeconds()
        } catch {}
    }

    return [pscustomobject]@{
        usedPercent = [double]$Window.utilization
        windowDurationMins = $DurationMins
        resetsAt = $resetsAt
    }
}

# Claude Code tient ses compteurs a jour dans ~/.claude.json. On lit cette
# source en priorite : la statusline, elle, ne s'execute pas dans l'extension
# VS Code, ce qui laissait le cache fige pendant des heures.
# ~/.claude.json ne peut pas etre parse en entier : il contient des chemins de
# projet qui ne different que par la casse, et ConvertFrom-Json de PowerShell
# 5.1 rejette le document entier pour cause de cles en double. On decoupe donc
# le seul objet utile en suivant l'imbrication des accolades.
function Get-JsonObjectFragment {
    param([string]$Text, [string]$Key)

    $marker = '"{0}"' -f $Key
    $start = $Text.IndexOf($marker)
    if ($start -lt 0) { return '' }

    $open = $Text.IndexOf('{', $start + $marker.Length)
    if ($open -lt 0) { return '' }

    $depth = 0
    $inString = $false
    $escaped = $false

    for ($index = $open; $index -lt $Text.Length; $index++) {
        $char = $Text[$index]

        if ($escaped) { $escaped = $false; continue }
        if ($inString -and $char -eq '\') { $escaped = $true; continue }
        if ($char -eq '"') { $inString = -not $inString; continue }
        if ($inString) { continue }

        if ($char -eq '{') {
            $depth++
        } elseif ($char -eq '}') {
            $depth--
            if ($depth -eq 0) { return $Text.Substring($open, $index - $open + 1) }
        }
    }

    return ''
}

function Get-ClaudeLiveQuota {
    $path = Join-Path $env:USERPROFILE '.claude.json'
    if (-not (Test-Path -LiteralPath $path)) { return $null }

    try {
        $raw = Get-Content -Raw -LiteralPath $path
        $fragment = Get-JsonObjectFragment -Text $raw -Key 'cachedUsageUtilization'
        if (-not $fragment) { return $null }

        $usage = ($fragment | ConvertFrom-Json).utilization
        if ($null -eq $usage) { return $null }

        return [pscustomobject]@{
            Primary = ConvertTo-QuotaWindow -Window $usage.five_hour -DurationMins 300
            Secondary = ConvertTo-QuotaWindow -Window $usage.seven_day -DurationMins 10080
        }
    } catch {
        return $null
    }
}

# Repli : le cache alimente par la statusline, quand elle tourne.
function Get-ClaudeCachedQuota {
    $path = Join-Path $PSScriptRoot 'claude-quota.json'
    if (-not (Test-Path -LiteralPath $path)) { return $null }

    try {
        $cache = Get-Content -Raw -LiteralPath $path | ConvertFrom-Json
        $now = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()

        return [pscustomobject]@{
            Primary = if ($null -ne $cache.fiveHourUsed -and [long]$cache.fiveHourResetsAt -gt $now) {
                [pscustomobject]@{ usedPercent = $cache.fiveHourUsed; windowDurationMins = 300; resetsAt = $cache.fiveHourResetsAt }
            } else { $null }
            Secondary = if ($null -ne $cache.sevenDayUsed -and [long]$cache.sevenDayResetsAt -gt $now) {
                [pscustomobject]@{ usedPercent = $cache.sevenDayUsed; windowDurationMins = 10080; resetsAt = $cache.sevenDayResetsAt }
            } else { $null }
        }
    } catch {
        return $null
    }
}

function Get-ClaudeQuotaText {
    param([switch]$ApplyPreference)

    $quota = Get-ClaudeLiveQuota
    if ($null -eq $quota -or ($null -eq $quota.Primary -and $null -eq $quota.Secondary)) {
        $quota = Get-ClaudeCachedQuota
    }
    if ($null -eq $quota) { return '' }

    return Format-QuotaText -Primary $quota.Primary -Secondary $quota.Secondary -ForAgent 'Claude' -ApplyPreference:$ApplyPreference
}

if ($CacheClaudeQuota) {
    try {
        $statusData = [Console]::In.ReadToEnd() | ConvertFrom-Json
        $rateLimits = if ($null -ne $statusData.rate_limits) {
            $statusData.rate_limits
        } elseif ($null -ne $statusData.rate_limit_info.unifiedWindows) {
            $statusData.rate_limit_info.unifiedWindows
        } else {
            $null
        }

        if ($null -ne $rateLimits) {
            $fiveHourUsed = if ($null -ne $rateLimits.five_hour.used_percentage) {
                [double]$rateLimits.five_hour.used_percentage
            } elseif ($null -ne $rateLimits.five_hour.utilization) {
                [double]$rateLimits.five_hour.utilization
            } else { $null }
            $sevenDayUsed = if ($null -ne $rateLimits.seven_day.used_percentage) {
                [double]$rateLimits.seven_day.used_percentage
            } elseif ($null -ne $rateLimits.seven_day.utilization) {
                [double]$rateLimits.seven_day.utilization
            } else { $null }
            [ordered]@{
                fiveHourUsed = $fiveHourUsed
                fiveHourResetsAt = if ($null -ne $rateLimits.five_hour.resets_at) { $rateLimits.five_hour.resets_at } else { $rateLimits.five_hour.resetsAt }
                sevenDayUsed = $sevenDayUsed
                sevenDayResetsAt = if ($null -ne $rateLimits.seven_day.resets_at) { $rateLimits.seven_day.resets_at } else { $rateLimits.seven_day.resetsAt }
            } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'claude-quota.json') -Encoding UTF8
        }
    } catch {}
    exit 0
}

if ($PrintQuota) {
    $value = if ($Agent -eq 'Codex') { Get-CodexQuotaText } else { Get-ClaudeQuotaText }
    if ($value) { [Console]::Out.WriteLine($value) }
    exit 0
}

# Return immediately to the agent hook, then show the popup in its own process.
if (-not $Display) {
    $rawPayload = ''
    if ($ReadStdin) {
        $rawPayload = [Console]::In.ReadToEnd()
    } elseif ($HookPayload.Count -gt 0) {
        $rawPayload = $HookPayload[-1]
    }

    if ($State -eq 'Done' -and $rawPayload) {
        try {
            $data = $rawPayload | ConvertFrom-Json
            $lastMessage = if ($data.'last-assistant-message') {
                [string]$data.'last-assistant-message'
            } elseif ($data.last_assistant_message) {
                [string]$data.last_assistant_message
            } else {
                ''
            }

            $tail = if ($lastMessage.Length -gt 600) {
                $lastMessage.Substring($lastMessage.Length - 600)
            } else {
                $lastMessage
            }

            if ($tail -match '(?is)\?\s*$|\b(would you|do you want|need you to|peux.tu|pouvez.vous|souhaites.tu)\b') {
                $State = 'Question'
            } elseif ($tail -match '(?i)\b(blocked|bloqu|need your input|besoin de toi|besoin de ton|besoin de ta|besoin de votre)') {
                $State = 'Blocked'
            } elseif ($lastMessage -match '(?i)\b(tests? (pass|passed|succeed|successful)|tests? valid|build (pass|passed|successful)|tout est valid)') {
                $State = 'Tested'
            } elseif ($lastMessage -match '(?i)\b(implement|modifi|ajout|corrig|r.par|refactor|fixed|updated|created|cr..|cod|fichier|files?)') {
                $State = 'Code'
            }
        } catch {
            $State = 'Done'
        }
    }

    # Le panneau VS Code montre tout ; la popup ne montre que les fenetres cochees,
    # sauf l'alerte de quota qui doit forcement afficher la barre concernee.
    $filter = $State -ne 'Quota'
    $QuotaText = if ($Agent -eq 'Codex') {
        Get-CodexQuotaText -ApplyPreference:$filter
    } else {
        Get-ClaudeQuotaText -ApplyPreference:$filter
    }

    $powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $arguments = '-NoProfile -NonInteractive -STA -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}" -Agent "{1}" -State "{2}"' -f $PSCommandPath, $Agent, $State
    if ($QuotaText) { $arguments += ' -QuotaText "{0}"' -f $QuotaText }
    if ($Detail) { $arguments += ' -Detail "{0}"' -f $Detail }
    $arguments += ' -Display'
    Start-Process -FilePath $powershell -ArgumentList $arguments -WindowStyle Hidden
    exit 0
}


# ---------------------------------------------------------------------------
# Rendu de la popup (processus dedie, WPF)
# ---------------------------------------------------------------------------

Add-Type -AssemblyName PresentationFramework

# Le fichier reste en ASCII pur : les accents passent par des points de code.
$eAcute = [string][char]0x00E9
$eCirc = [string][char]0x00EA
$aGrave = [string][char]0x00E0

$fontText = [System.Windows.Media.FontFamily]::new('Segoe UI Variable Text, Segoe UI')
$fontDisplay = [System.Windows.Media.FontFamily]::new('Segoe UI Variable Display, Segoe UI')

function New-Color {
    param([string]$Hex)
    return [System.Windows.Media.Color][System.Windows.Media.ColorConverter]::ConvertFromString($Hex)
}

function New-Brush {
    param([string]$Hex, [double]$Opacity = 1)
    $brush = [System.Windows.Media.SolidColorBrush]::new((New-Color $Hex))
    $brush.Opacity = $Opacity
    return $brush
}

function New-VerticalGradient {
    param([string]$TopHex, [string]$BottomHex)
    $brush = [System.Windows.Media.LinearGradientBrush]::new()
    $brush.StartPoint = [System.Windows.Point]::new(0, 0)
    $brush.EndPoint = [System.Windows.Point]::new(0, 1)
    $null = $brush.GradientStops.Add([System.Windows.Media.GradientStop]::new((New-Color $TopHex), 0))
    $null = $brush.GradientStops.Add([System.Windows.Media.GradientStop]::new((New-Color $BottomHex), 1))
    return $brush
}

function New-Label {
    param(
        [string]$Content,
        [double]$Size,
        [string]$Hex,
        [double]$Opacity = 1,
        [switch]$SemiBold,
        $Font = $null
    )
    $block = [System.Windows.Controls.TextBlock]::new()
    $block.Text = $Content
    $block.FontFamily = if ($Font) { $Font } else { $fontText }
    $block.FontSize = $Size
    $block.Foreground = New-Brush $Hex $Opacity
    if ($SemiBold) { $block.FontWeight = [System.Windows.FontWeights]::SemiBold }
    $block.VerticalAlignment = [System.Windows.VerticalAlignment]::Center
    $block.TextWrapping = [System.Windows.TextWrapping]::NoWrap
    return $block
}

function New-Bar {
    param([double]$Width, [double]$Height, [string]$Hex, [double]$Opacity = 1)
    $bar = [System.Windows.Controls.Border]::new()
    $bar.Width = $Width
    $bar.Height = $Height
    $bar.CornerRadius = [System.Windows.CornerRadius]::new($Height / 2)
    $bar.Background = New-Brush $Hex $Opacity
    return $bar
}

# --- Palette ---------------------------------------------------------------
# L'identite de l'agent tient a sa couleur d'accent et non au fond : un meme
# fond sombre pour les deux agents rend le texte nettement plus lisible.
$surfaceTop = '#2A2C34'
$surfaceBottom = '#16171B'
$hairline = '#FFFFFF'
$titleInk = '#F6F6F8'
$bodyInk = '#A2AAB6'
$mutedInk = '#7C848F'

$agentAccent = if ($Agent -eq 'Claude') { '#E08A63' } else { '#19C37D' }

$stateInfo = switch ($State) {
    'Quota' {
        @{
            Glyph = '!'
            Tone = '#F27059'
            Title = '{0} : quota hebdomadaire bas' -f $Agent
            Detail = 'La limite 7 j approche'
        }
    }
    'Question' {
        @{
            Glyph = '?'
            Tone = '#F5B75A'
            Title = '{0} attend ta r{1}ponse' -f $Agent, $eAcute
            Detail = 'Une question t{0}attend dans VS Code' -f [char]0x2019
        }
    }
    'Blocked' {
        @{
            Glyph = '!'
            Tone = '#F27059'
            Title = '{0} a besoin de toi' -f $Agent
            Detail = 'T{0}che en pause' -f $aGrave
        }
    }
    'Tested' {
        @{
            Glyph = [string][char]0x2713
            Tone = '#4ADE80'
            Title = '{0} a termin{1}' -f $Agent, $eAcute
            Detail = 'Tests valid{0}s' -f $eAcute
        }
    }
    'Code' {
        @{
            Glyph = [string][char]0x2713
            Tone = $agentAccent
            Title = '{0} a termin{1}' -f $Agent, $eAcute
            Detail = 'Le code a {0}t{0} modifi{0}' -f $eAcute
        }
    }
    default {
        @{
            Glyph = [string][char]0x2713
            Tone = $agentAccent
            Title = '{0} a termin{1}' -f $Agent, $eAcute
            Detail = 'La r{0}ponse est pr{1}te' -f $eAcute, $eCirc
        }
    }
}

if ($Detail) { $stateInfo.Detail = $Detail }

$tone = $stateInfo.Tone

# --- Fenetre ---------------------------------------------------------------
$window = [System.Windows.Window]::new()
$window.SizeToContent = [System.Windows.SizeToContent]::WidthAndHeight
$window.WindowStyle = [System.Windows.WindowStyle]::None
$window.ResizeMode = [System.Windows.ResizeMode]::NoResize
$window.ShowInTaskbar = $false
$window.ShowActivated = $false
$window.Topmost = $true
$window.AllowsTransparency = $true
$window.Background = [System.Windows.Media.Brushes]::Transparent
$window.WindowStartupLocation = [System.Windows.WindowStartupLocation]::Manual
$window.Opacity = 0

$card = [System.Windows.Controls.Border]::new()
$card.Background = New-VerticalGradient $surfaceTop $surfaceBottom
$card.BorderBrush = New-Brush $hairline 0.14
$card.BorderThickness = [System.Windows.Thickness]::new(1)
$card.CornerRadius = [System.Windows.CornerRadius]::new(18)
$card.Padding = [System.Windows.Thickness]::new(20, 17, 22, 16)
$card.MinWidth = 340
$card.RenderTransformOrigin = [System.Windows.Point]::new(0.5, 1)

$scale = [System.Windows.Media.ScaleTransform]::new(0.96, 0.96)
$slide = [System.Windows.Media.TranslateTransform]::new(0, 18)
$transforms = [System.Windows.Media.TransformGroup]::new()
$null = $transforms.Children.Add($scale)
$null = $transforms.Children.Add($slide)
$card.RenderTransform = $transforms

$shadow = [System.Windows.Media.Effects.DropShadowEffect]::new()
$shadow.BlurRadius = 32
$shadow.ShadowDepth = 7
$shadow.Direction = 270
$shadow.Opacity = 0.5
$shadow.Color = [System.Windows.Media.Colors]::Black
$card.Effect = $shadow

$root = [System.Windows.Controls.StackPanel]::new()
$root.Orientation = [System.Windows.Controls.Orientation]::Vertical

# --- En-tete : pastille d'etat, titre, sous-titre --------------------------
$header = [System.Windows.Controls.Grid]::new()
foreach ($width in @([System.Windows.GridLength]::Auto, [System.Windows.GridLength]::new(1, [System.Windows.GridUnitType]::Star))) {
    $column = [System.Windows.Controls.ColumnDefinition]::new()
    $column.Width = $width
    $header.ColumnDefinitions.Add($column)
}

$badge = [System.Windows.Controls.Border]::new()
$badge.Width = 38
$badge.Height = 38
$badge.CornerRadius = [System.Windows.CornerRadius]::new(12)
$badge.Background = New-Brush $tone 0.16
$badge.BorderBrush = New-Brush $tone 0.4
$badge.BorderThickness = [System.Windows.Thickness]::new(1)
$badge.VerticalAlignment = [System.Windows.VerticalAlignment]::Center

$glyph = New-Label -Content $stateInfo.Glyph -Size 17 -Hex $tone -Font $fontDisplay
$glyph.FontWeight = [System.Windows.FontWeights]::Bold
$glyph.HorizontalAlignment = [System.Windows.HorizontalAlignment]::Center
$glyph.Margin = [System.Windows.Thickness]::new(0, -1, 0, 0)
$badge.Child = $glyph

$headerText = [System.Windows.Controls.StackPanel]::new()
$headerText.Orientation = [System.Windows.Controls.Orientation]::Vertical
$headerText.VerticalAlignment = [System.Windows.VerticalAlignment]::Center
$headerText.Margin = [System.Windows.Thickness]::new(14, 0, 0, 0)

$title = New-Label -Content $stateInfo.Title -Size 16.5 -Hex $titleInk -SemiBold -Font $fontDisplay
$title.HorizontalAlignment = [System.Windows.HorizontalAlignment]::Left

$subtitle = New-Label -Content $stateInfo.Detail -Size 11.5 -Hex $bodyInk
$subtitle.HorizontalAlignment = [System.Windows.HorizontalAlignment]::Left
$subtitle.Margin = [System.Windows.Thickness]::new(0, 3, 0, 0)

$null = $headerText.Children.Add($title)
$null = $headerText.Children.Add($subtitle)

[System.Windows.Controls.Grid]::SetColumn($badge, 0)
[System.Windows.Controls.Grid]::SetColumn($headerText, 1)
$null = $header.Children.Add($badge)
$null = $header.Children.Add($headerText)
$null = $root.Children.Add($header)

# --- Quotas ----------------------------------------------------------------
$quotaFills = @()
if ($QuotaText) {
    $entries = [regex]::Matches($QuotaText, '(\d+\s*(?:min|h|j))\s+(\d+)\s*%(?:\s+reset\s+([^|]+))?')

    if ($entries.Count -gt 0) {
        $separator = [System.Windows.Controls.Border]::new()
        $separator.Height = 1
        $separator.Background = New-Brush $hairline 0.1
        $separator.Margin = [System.Windows.Thickness]::new(0, 15, 0, 13)
        $null = $root.Children.Add($separator)

        $captionText = 'QUOTA CONSOMM{0}' -f ([char]0x00C9)
        $caption = New-Label -Content $captionText -Size 9.5 -Hex $mutedInk -SemiBold
        $caption.HorizontalAlignment = [System.Windows.HorizontalAlignment]::Left
        $caption.Margin = [System.Windows.Thickness]::new(1, 0, 0, 8)
        $null = $root.Children.Add($caption)

        $grid = [System.Windows.Controls.Grid]::new()
        foreach ($index in 0..3) {
            $column = [System.Windows.Controls.ColumnDefinition]::new()
            $column.Width = [System.Windows.GridLength]::Auto
            $grid.ColumnDefinitions.Add($column)
        }

        $rowIndex = 0
        foreach ($entry in $entries) {
            $row = [System.Windows.Controls.RowDefinition]::new()
            $row.Height = [System.Windows.GridLength]::Auto
            $grid.RowDefinitions.Add($row)

            $percent = [Math]::Min(100, [Math]::Max(0, [int]$entry.Groups[2].Value))
            $resetIn = $entry.Groups[3].Value.Trim()
            $barTone = if ($percent -ge 80) { '#F27059' } elseif ($percent -ge 60) { '#F5B75A' } else { $agentAccent }

            $windowLabel = New-Label -Content $entry.Groups[1].Value -Size 11 -Hex $bodyInk
            $windowLabel.MinWidth = 30
            $windowLabel.Margin = [System.Windows.Thickness]::new(1, 4, 0, 4)

            $track = New-Bar -Width 168 -Height 8 -Hex $hairline -Opacity 0.11
            $track.Margin = [System.Windows.Thickness]::new(10, 4, 12, 4)

            $fill = New-Bar -Width 0 -Height 8 -Hex $barTone
            $fill.HorizontalAlignment = [System.Windows.HorizontalAlignment]::Left
            $track.Child = $fill

            $percentLabel = New-Label -Content ('{0} %' -f $percent) -Size 11.5 -Hex $titleInk -SemiBold
            $percentLabel.MinWidth = 40
            $percentLabel.TextAlignment = [System.Windows.TextAlignment]::Right
            $percentLabel.Margin = [System.Windows.Thickness]::new(0, 4, 0, 4)

            $resetContent = if ($resetIn) { 'reset dans {0}' -f $resetIn } else { '' }
            $resetLabel = New-Label -Content $resetContent -Size 10.5 -Hex $mutedInk
            $resetLabel.Margin = [System.Windows.Thickness]::new(14, 4, 0, 4)

            $cells = @($windowLabel, $track, $percentLabel, $resetLabel)
            for ($column = 0; $column -lt $cells.Count; $column++) {
                [System.Windows.Controls.Grid]::SetRow($cells[$column], $rowIndex)
                [System.Windows.Controls.Grid]::SetColumn($cells[$column], $column)
                $null = $grid.Children.Add($cells[$column])
            }

            $quotaFills += [pscustomobject]@{ Fill = $fill; Target = 168 * $percent / 100 }
            $rowIndex++
        }

        $null = $root.Children.Add($grid)
    }
}

# --- Ligne de vie : temps restant avant fermeture --------------------------
$progressTrack = [System.Windows.Controls.Border]::new()
$progressTrack.Height = 3
$progressTrack.CornerRadius = [System.Windows.CornerRadius]::new(1.5)
$progressTrack.Background = New-Brush $hairline 0.07
$progressTrack.Margin = [System.Windows.Thickness]::new(0, 16, 0, 0)

$progressFill = [System.Windows.Controls.Border]::new()
$progressFill.Height = 3
$progressFill.Width = 0
$progressFill.CornerRadius = [System.Windows.CornerRadius]::new(1.5)
$progressFill.Background = New-Brush $tone 0.7
$progressFill.HorizontalAlignment = [System.Windows.HorizontalAlignment]::Left
$progressTrack.Child = $progressFill
$null = $root.Children.Add($progressTrack)

$card.Child = $root
$window.Content = $card

# --- Animations et cycle de vie --------------------------------------------
$ease = [System.Windows.Media.Animation.CubicEase]::new()
$ease.EasingMode = [System.Windows.Media.Animation.EasingMode]::EaseOut

$script:progressWidth = 0
$script:closing = $false

$timer = [System.Windows.Threading.DispatcherTimer]::new()
$timer.Interval = [TimeSpan]::FromSeconds(5.5)

function New-Fade {
    param([double]$From, [double]$To, [int]$Milliseconds)
    $animation = [System.Windows.Media.Animation.DoubleAnimation]::new()
    $animation.From = $From
    $animation.To = $To
    $animation.Duration = [System.Windows.Duration]::new([TimeSpan]::FromMilliseconds($Milliseconds))
    $animation.EasingFunction = $ease
    return $animation
}

function Start-Countdown {
    if ($script:closing) { return }
    $timer.Stop()
    $countdown = [System.Windows.Media.Animation.DoubleAnimation]::new()
    $countdown.From = $script:progressWidth
    $countdown.To = 0
    $countdown.Duration = [System.Windows.Duration]::new($timer.Interval)
    $progressFill.BeginAnimation([System.Windows.FrameworkElement]::WidthProperty, $countdown)
    $timer.Start()
}

function Stop-Countdown {
    $timer.Stop()
    $progressFill.BeginAnimation([System.Windows.FrameworkElement]::WidthProperty, $null)
    $progressFill.Width = $script:progressWidth
}

function Invoke-Dismiss {
    if ($script:closing) { return }
    $script:closing = $true
    $timer.Stop()
    $fadeOut = New-Fade -From $window.Opacity -To 0 -Milliseconds 380
    $fadeOut.Add_Completed({ $window.Close() })
    $slide.BeginAnimation([System.Windows.Media.TranslateTransform]::YProperty, (New-Fade -From 0 -To 12 -Milliseconds 380))
    $window.BeginAnimation([System.Windows.Window]::OpacityProperty, $fadeOut)
}

$timer.Add_Tick({ Invoke-Dismiss })

# Survol : le compte a rebours se fige et repart a zero ; un clic ferme.
$window.Add_MouseEnter({ Stop-Countdown })
$window.Add_MouseLeave({ Start-Countdown })
$window.Add_MouseLeftButtonUp({ Invoke-Dismiss })

$window.Add_ContentRendered({
    $workArea = [System.Windows.SystemParameters]::WorkArea
    $window.Left = $workArea.Left + (($workArea.Width - $window.ActualWidth) / 2)
    $window.Top = $workArea.Bottom - $window.ActualHeight - 64

    $script:progressWidth = $progressTrack.ActualWidth

    $window.BeginAnimation([System.Windows.Window]::OpacityProperty, (New-Fade -From 0 -To 1 -Milliseconds 260))
    $scale.BeginAnimation([System.Windows.Media.ScaleTransform]::ScaleXProperty, (New-Fade -From 0.96 -To 1 -Milliseconds 340))
    $scale.BeginAnimation([System.Windows.Media.ScaleTransform]::ScaleYProperty, (New-Fade -From 0.96 -To 1 -Milliseconds 340))
    $slide.BeginAnimation([System.Windows.Media.TranslateTransform]::YProperty, (New-Fade -From 18 -To 0 -Milliseconds 340))

    foreach ($item in $quotaFills) {
        $barAnimation = New-Fade -From 0 -To $item.Target -Milliseconds 620
        $item.Fill.BeginAnimation([System.Windows.FrameworkElement]::WidthProperty, $barAnimation)
    }

    Start-Countdown
})

$null = $window.ShowDialog()
