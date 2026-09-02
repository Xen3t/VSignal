[CmdletBinding(PositionalBinding = $false)]
param(
    [Parameter(Position = 0)]
    [ValidateSet('Claude', 'Codex')]
    [string]$Agent,

    [ValidateSet('Done', 'Question', 'Code', 'Tested', 'Blocked', 'Quota', 'Reset')]
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

# Tracés officiels des marques Claude et Codex, repris des extensions
# anthropic.claude-code et openai.chatgpt. Ils identifient les produits ;
# ils appartiennent a Anthropic et OpenAI et ne sont pas couverts par la
# licence MIT de VSignal.
$claudeMarkPath = 'M4.709 15.955l4.72-2.647.08-.23-.08-.128H9.2l-.79-.048-2.698-.073-2.339-.097-2.266-.122-.571-.121L0 11.784l.055-.352.48-.321.686.06 1.52.103 2.278.158 1.652.097 2.449.255h.389l.055-.157-.134-.098-.103-.097-2.358-1.596-2.552-1.688-1.336-.972-.724-.491-.364-.462-.158-1.008.656-.722.881.06.225.061.893.686 1.908 1.476 2.491 1.833.365.304.145-.103.019-.073-.164-.274-1.355-2.446-1.446-2.49-.644-1.032-.17-.619a2.97 2.97 0 01-.104-.729L6.283.134 6.696 0l.996.134.42.364.62 1.414 1.002 2.229 1.555 3.03.456.898.243.832.091.255h.158V9.01l.128-1.706.237-2.095.23-2.695.08-.76.376-.91.747-.492.584.28.48.685-.067.444-.286 1.851-.559 2.903-.364 1.942h.212l.243-.242.985-1.306 1.652-2.064.73-.82.85-.904.547-.431h1.033l.76 1.129-.34 1.166-1.064 1.347-.881 1.142-1.264 1.7-.79 1.36.073.11.188-.02 2.856-.606 1.543-.28 1.841-.315.833.388.091.395-.328.807-1.969.486-2.309.462-3.439.813-.042.03.049.061 1.549.146.662.036h1.622l3.02.225.79.522.474.638-.079.485-1.215.62-1.64-.389-3.829-.91-1.312-.329h-.182v.11l1.093 1.068 2.006 1.81 2.509 2.33.127.578-.322.455-.34-.049-2.205-1.657-.851-.747-1.926-1.62h-.128v.17l.444.649 2.345 3.521.122 1.08-.17.353-.608.213-.668-.122-1.374-1.925-1.415-2.167-1.143-1.943-.14.08-.674 7.254-.316.37-.729.28-.607-.461-.322-.747.322-1.476.389-1.924.315-1.53.286-1.9.17-.632-.012-.042-.14.018-1.434 1.967-2.18 2.945-1.726 1.845-.414.164-.717-.37.067-.662.401-.589 2.388-3.036 1.44-1.882.93-1.086-.006-.158h-.055L4.132 18.56l-1.13.146-.487-.456.061-.746.231-.243 1.908-1.312-.006.006z'
$codexMarkPath = 'M13.798 23.976a5.7 5.7 0 0 1-2.26-.456 6.1 6.1 0 0 1-1.903-1.27 5.7 5.7 0 0 1-1.88.311 5.75 5.75 0 0 1-2.95-.79 6.2 6.2 0 0 1-2.188-2.159q-.81-1.366-.809-3.045 0-.695.19-1.51a6.4 6.4 0 0 1-1.475-2.038A5.95 5.95 0 0 1 0 10.573Q0 9.278.547 8.08q.547-1.2 1.523-2.062a5.5 5.5 0 0 1 2.307-1.223A5.7 5.7 0 0 1 5.472 2.35 6.1 6.1 0 0 1 7.565.623 5.8 5.8 0 0 1 10.206 0q1.19 0 2.26.456a6.1 6.1 0 0 1 1.903 1.27 5.7 5.7 0 0 1 1.88-.311q1.594 0 2.95.79a6 6 0 0 1 2.165 2.159q.832 1.366.832 3.045 0 .695-.19 1.51a6.3 6.3 0 0 1 1.475 2.062q.523 1.15.523 2.422a5.9 5.9 0 0 1-.547 2.493q-.547 1.2-1.546 2.086a5.4 5.4 0 0 1-2.284 1.199 5.56 5.56 0 0 1-1.118 2.445 5.9 5.9 0 0 1-2.07 1.727 5.8 5.8 0 0 1-2.64.623m-5.876-2.997q1.19 0 2.07-.504l4.472-2.589a.53.53 0 0 0 .238-.455v-2.062L8.945 18.7a.96.96 0 0 1-1.047 0l-4.496-2.613a.7.7 0 0 1-.024.168v.287q0 1.224.571 2.254a4.24 4.24 0 0 0 1.642 1.583q1.047.6 2.331.599m.238-3.908a.6.6 0 0 0 .262.072q.118 0 .238-.072l1.784-1.031-5.734-3.357q-.522-.312-.523-.935V6.545a4.3 4.3 0 0 0-1.903 1.63 4.25 4.25 0 0 0-.714 2.398q0 1.176.595 2.254.594 1.08 1.546 1.63zm5.638 5.323q1.26 0 2.284-.576a4.3 4.3 0 0 0 1.618-1.582q.595-1.008.595-2.254v-5.179a.47.47 0 0 0-.238-.431l-1.808-1.055v6.689q0 .624-.524.935l-4.496 2.613a4.3 4.3 0 0 0 2.57.84m.904-8.776v-3.26l-2.688-1.535-2.712 1.535v3.26l2.712 1.535zM7.756 5.97q0-.623.523-.935l4.496-2.613a4.3 4.3 0 0 0-2.569-.84q-1.26 0-2.284.576A4.3 4.3 0 0 0 6.304 3.74q-.57 1.008-.57 2.254v5.155q0 .287.237.455l1.785 1.055zM19.84 17.43a4.16 4.16 0 0 0 1.88-1.63 4.33 4.33 0 0 0 .713-2.397q0-1.176-.595-2.254-.594-1.08-1.546-1.63l-4.449-2.59q-.143-.096-.261-.072a.46.46 0 0 0-.238.072L13.56 7.936l5.758 3.38a.9.9 0 0 1 .38.384q.143.216.143.528zM15.059 5.25q.524-.335 1.047 0l4.52 2.662V7.48q0-1.15-.57-2.181A4.14 4.14 0 0 0 18.46 3.62q-1.023-.623-2.379-.623-1.19 0-2.07.503L9.54 6.09a.53.53 0 0 0-.238.455v2.062z'

function New-AgentMark {
    param([string]$Agent, [double]$Size, [string]$Hex)

    $mark = [System.Windows.Shapes.Path]::new()
    $mark.Data = [System.Windows.Media.Geometry]::Parse($(if ($Agent -eq 'Codex') { $codexMarkPath } else { $claudeMarkPath }))
    $mark.Fill = New-Brush $Hex
    $mark.Stretch = [System.Windows.Media.Stretch]::Uniform
    $mark.Width = $Size
    $mark.Height = $Size
    $mark.HorizontalAlignment = [System.Windows.HorizontalAlignment]::Center
    $mark.VerticalAlignment = [System.Windows.VerticalAlignment]::Center
    return $mark
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

# La couleur ne porte plus l'identite du modele, seulement la gravite : un
# quota confortable etait affiche dans l'orange de Claude et se lisait comme
# une alerte. L'identite passe desormais par la marque de l'agent.
$toneOk = '#4ADE80'
$toneWarn = '#F5B75A'
$toneAlert = '#F27059'
$toneNeutral = '#FFFFFF'

# Couleur de marque, utilisee uniquement pour dessiner le logo.
$agentMarkInk = if ($Agent -eq 'Claude') { '#D97757' } else { '#FFFFFF' }

$stateInfo = switch ($State) {
    'Quota' {
        @{
            Tone = $toneAlert
            Title = '{0} : quota bas' -f $Agent
            Detail = 'La limite approche'
        }
    }
    'Reset' {
        @{
            Tone = $toneOk
            Title = '{0} : quota r{1}initialis{1}' -f $Agent, $eAcute
            Detail = 'La fen{0}tre est repartie {1} z{2}ro' -f $eCirc, $aGrave, $eAcute
        }
    }
    'Question' {
        @{
            Tone = $toneWarn
            Title = '{0} attend ta r{1}ponse' -f $Agent, $eAcute
            Detail = 'Une question t{0}attend dans VS Code' -f [char]0x2019
        }
    }
    'Blocked' {
        @{
            Tone = $toneAlert
            Title = '{0} a besoin de toi' -f $Agent
            Detail = 'T{0}che en pause' -f $aGrave
        }
    }
    'Tested' {
        @{
            Tone = $toneOk
            Title = '{0} a termin{1}' -f $Agent, $eAcute
            Detail = 'Tests valid{0}s' -f $eAcute
        }
    }
    'Code' {
        @{
            Tone = $toneNeutral
            Title = '{0} a termin{1}' -f $Agent, $eAcute
            Detail = 'Le code a {0}t{0} modifi{0}' -f $eAcute
        }
    }
    default {
        @{
            Tone = $toneNeutral
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
$card.MinWidth = 370
$card.RenderTransformOrigin = [System.Windows.Point]::new(1, 0)

$scale = [System.Windows.Media.ScaleTransform]::new(0.96, 0.96)
$slide = [System.Windows.Media.TranslateTransform]::new(26, 0)
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
$badge.Width = 46
$badge.Height = 46
$badge.CornerRadius = [System.Windows.CornerRadius]::new(14)
$badge.Background = New-Brush $toneNeutral 0.06
$isAlert = $tone -ne $toneNeutral
$badge.BorderBrush = if ($isAlert) { New-Brush $tone 0.5 } else { New-Brush $toneNeutral 0.12 }
$badge.BorderThickness = [System.Windows.Thickness]::new(1)
$badge.VerticalAlignment = [System.Windows.VerticalAlignment]::Center

$badge.Child = New-AgentMark -Agent $Agent -Size 25 -Hex $agentMarkInk

$headerText = [System.Windows.Controls.StackPanel]::new()
$headerText.Orientation = [System.Windows.Controls.Orientation]::Vertical
$headerText.VerticalAlignment = [System.Windows.VerticalAlignment]::Center
$headerText.Margin = [System.Windows.Thickness]::new(16, 0, 0, 0)

$title = New-Label -Content $stateInfo.Title -Size 21 -Hex $titleInk -SemiBold -Font $fontDisplay
$title.HorizontalAlignment = [System.Windows.HorizontalAlignment]::Left

$subtitle = New-Label -Content $stateInfo.Detail -Size 12.5 -Hex $bodyInk
$subtitle.HorizontalAlignment = [System.Windows.HorizontalAlignment]::Left
$subtitle.Margin = [System.Windows.Thickness]::new(0, 4, 0, 0)

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
        $separator.Margin = [System.Windows.Thickness]::new(0, 15, 0, 11)
        $null = $root.Children.Add($separator)

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
            # Pourcentage consomme : bas vaut mieux que haut.
            $barTone = if ($percent -ge 80) { $toneAlert } elseif ($percent -ge 60) { $toneWarn } else { $toneOk }

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
    $slide.BeginAnimation([System.Windows.Media.TranslateTransform]::XProperty, (New-Fade -From 0 -To 20 -Milliseconds 380))
    $window.BeginAnimation([System.Windows.Window]::OpacityProperty, $fadeOut)
}

$timer.Add_Tick({ Invoke-Dismiss })

# Survol : le compte a rebours se fige et repart a zero ; un clic ferme.
$window.Add_MouseEnter({ Stop-Countdown })
$window.Add_MouseLeave({ Start-Countdown })
$window.Add_MouseLeftButtonUp({ Invoke-Dismiss })

$window.Add_ContentRendered({
    $workArea = [System.Windows.SystemParameters]::WorkArea
    $window.Left = $workArea.Right - $window.ActualWidth - 22
    $window.Top = $workArea.Top + 22

    $script:progressWidth = $progressTrack.ActualWidth

    $window.BeginAnimation([System.Windows.Window]::OpacityProperty, (New-Fade -From 0 -To 1 -Milliseconds 260))
    $scale.BeginAnimation([System.Windows.Media.ScaleTransform]::ScaleXProperty, (New-Fade -From 0.96 -To 1 -Milliseconds 340))
    $scale.BeginAnimation([System.Windows.Media.ScaleTransform]::ScaleYProperty, (New-Fade -From 0.96 -To 1 -Milliseconds 340))
    $slide.BeginAnimation([System.Windows.Media.TranslateTransform]::XProperty, (New-Fade -From 26 -To 0 -Milliseconds 340))

    foreach ($item in $quotaFills) {
        $barAnimation = New-Fade -From 0 -To $item.Target -Milliseconds 620
        $item.Fill.BeginAnimation([System.Windows.FrameworkElement]::WidthProperty, $barAnimation)
    }

    Start-Countdown
})

$null = $window.ShowDialog()
